/**
 * api/stanleystawa/accounts.js — Authentification, Inscription Sécurisée par OTP, Limite de 2 créations par Gmail & Suppression de Compte
 *
 * Actions :
 * - POST /stanleystawa/accounts?action=send_otp { email }
 * - POST /stanleystawa/accounts?action=register { email, password, otp }
 * - POST /stanleystawa/accounts?action=login { email, password }
 * - POST /stanleystawa/accounts?action=delete_account (avec x-api-key ou ?key=)
 * - GET  /stanleystawa/accounts?action=me (avec x-api-key ou ?key=)
 * - GET  /stanleystawa/accounts (Cluster status)
 */

const url = require("url");
const turso = require("../../lib/turso");
const security = require("../../lib/security");
const mailer = require("../../lib/mailer");

const MAX_REGISTRATIONS_PER_GMAIL = 2; // Limite stricte : Maximum 2 créations par adresse Gmail

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const parsedUrlQuery = url.parse(req.url || "", true).query || {};
  const query = { ...parsedUrlQuery, ...(req.query || {}) };
  const body = req.method === "POST" ? await readBody(req) : {};
  const params = { ...query, ...body };
  const action = String(params.action || query.action || body.action || "").toLowerCase();

  // ----------------------------------------------------
  // ACTION 1 : ENVOI DU CODE OTP AVEC CONTRÔLE DE LIMITE (MAX 2 PAR GMAIL)
  // ----------------------------------------------------
  if (action === "send_otp" || action === "sendotp" || action === "otp") {
    if (!security.checkRateLimit(req, 6)) {
      return res.status(429).json({ error: "Trop de demandes d'OTP. Veuillez patienter une minute." });
    }

    const email = (params.email || "").trim().toLowerCase();

    if (!email || !email.includes("@") || !email.includes(".")) {
      return res.status(400).json({ error: "Veuillez saisir une adresse e-mail valide." });
    }

    // 1. Blocage des e-mails jetables
    if (mailer.isDisposableEmail(email)) {
      return res.status(400).json({
        error: "Les adresses e-mails temporaires ou jetables sont strictement interdites. Veuillez utiliser une vraie adresse Gmail, Outlook ou Yahoo."
      });
    }

    try {
      // 2. Vérification de la limite stricte de 2 inscriptions par Gmail
      const regCount = await turso.getEmailRegistrationCount(email);
      if (regCount >= MAX_REGISTRATIONS_PER_GMAIL) {
        return res.status(403).json({
          error: `Limite maximale atteinte : Cette adresse Gmail a déjà été utilisée ${regCount} fois pour créer un compte (maximum autorisé : ${MAX_REGISTRATIONS_PER_GMAIL} fois).`
        });
      }

      // 3. Vérification si un compte est déjà actif avec cet e-mail
      const existing = await turso.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "Un compte actif existe déjà avec cette adresse e-mail. Veuillez vous connecter." });
      }

      // 4. Génération et enregistrement du code OTP à 6 chiffres
      const otpCode = mailer.generateOtp();
      await turso.saveOtp(email, otpCode, 10);

      // 5. Envoi réel de l'e-mail
      const sendResult = await mailer.sendOtpEmail(email, otpCode);

      if (!sendResult.sent) {
        return res.status(500).json({
          error: "Impossible d'expédier l'e-mail de vérification. Vérifiez votre adresse Gmail."
        });
      }

      return res.status(200).json({
        status: "success",
        message: `Code de vérification expédié à ${email} ! Vérifiez votre boîte de réception Gmail (et vos spams).`,
        email,
        creations_used: regCount,
        max_creations: MAX_REGISTRATIONS_PER_GMAIL,
        expires_in: "10 minutes"
      });
    } catch (err) {
      console.error("[Send OTP Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ----------------------------------------------------
  // ACTION 2 : INSCRIPTION AVEC VALIDATION OTP & ENREGISTREMENT HISTORIQUE
  // ----------------------------------------------------
  if (action === "register" || action === "signup") {
    if (!security.checkRateLimit(req, 10)) {
      return res.status(429).json({ error: "Trop de tentatives d'inscription. Veuillez patienter." });
    }

    const email = (params.email || "").trim().toLowerCase();
    const password = String(params.password || "").trim();
    const otp = String(params.otp || params.code || params.otp_code || "").trim();

    if (!email || !email.includes("@") || !email.includes(".")) {
      return res.status(400).json({ error: "Adresse e-mail valide requise." });
    }

    if (mailer.isDisposableEmail(email)) {
      return res.status(400).json({ error: "Les adresses jetables sont interdites. Utilisez une adresse Gmail réelle." });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
    }

    if (!otp || otp.length !== 6) {
      return res.status(400).json({
        error: "Le code de vérification OTP à 6 chiffres reçu dans votre boîte Gmail est obligatoire."
      });
    }

    try {
      // 1. Vérification de la limite de 2 créations par e-mail
      const regCount = await turso.getEmailRegistrationCount(email);
      if (regCount >= MAX_REGISTRATIONS_PER_GMAIL) {
        return res.status(403).json({
          error: `Limite maximale atteinte : Cette adresse Gmail a déjà été utilisée ${regCount} fois pour créer un compte (maximum autorisé : ${MAX_REGISTRATIONS_PER_GMAIL} fois).`
        });
      }

      // 2. Vérification du code OTP dans Turso DB
      const isValidOtp = await turso.verifyOtp(email, otp);
      if (!isValidOtp) {
        return res.status(400).json({
          error: "Code OTP incorrect ou expiré. Veuillez vérifier votre boîte e-mail ou redemander un nouveau code."
        });
      }

      // 3. Vérification compte existant
      const existing = await turso.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail." });
      }

      // 4. Création du compte et incrémentation de l'historique d'inscriptions
      const passwordHash = security.hashPassword(password);
      const userApiKey = security.generateUserApiKey();
      const welcomeCredits = 100;

      const user = await turso.createUser(email, passwordHash, userApiKey, welcomeCredits, "user");

      return res.status(201).json({
        status: "success",
        message: `E-mail vérifié et compte créé avec succès ! 100 crédits de bienvenue offerts (Création ${regCount + 1}/${MAX_REGISTRATIONS_PER_GMAIL} pour cet e-mail).`,
        user: {
          email: user.email,
          api_key: user.api_key,
          credits: user.credits,
          role: user.role
        }
      });
    } catch (err) {
      console.error("[Register Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ----------------------------------------------------
  // ACTION 3 : CONNEXION (LOGIN)
  // ----------------------------------------------------
  if (action === "login" || action === "signin") {
    if (!security.checkRateLimit(req, 15)) {
      return res.status(429).json({ error: "Trop de tentatives de connexion. Veuillez patienter." });
    }

    const email = (params.email || "").trim().toLowerCase();
    const password = String(params.password || "").trim();

    if (!email || !password) {
      return res.status(400).json({ error: "E-mail et mot de passe requis." });
    }

    try {
      const user = await turso.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Identifiants incorrects (aucun compte trouvé avec cet e-mail)." });
      }

      const passwordHash = security.hashPassword(password);
      if (user.password_hash !== passwordHash) {
        return res.status(401).json({ error: "Mot de passe incorrect." });
      }

      return res.status(200).json({
        status: "success",
        message: "Connexion réussie !",
        user: {
          id: user.id,
          email: user.email,
          api_key: user.api_key,
          credits: parseInt(user.credits || 0, 10),
          role: user.role
        }
      });
    } catch (err) {
      console.error("[Login Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ----------------------------------------------------
  // ACTION 4 : SUPPRESSION DÉFINITIVE DE COMPTE
  // ----------------------------------------------------
  if (action === "delete_account" || action === "delete" || action === "deleteaccount") {
    try {
      const auth = await security.authenticateRequest(req);
      if (!auth.authorized || !auth.user) {
        return res.status(401).json({ error: "Authentification requise pour supprimer votre compte." });
      }

      if (auth.is_admin && auth.key === security.MASTER_API_KEY) {
        return res.status(400).json({ error: "Le compte administrateur maître ne peut pas être supprimé." });
      }

      const deleted = await turso.deleteUserAccount(auth.key);
      if (!deleted) {
        return res.status(404).json({ error: "Compte introuvable ou déjà supprimé." });
      }

      return res.status(200).json({
        status: "success",
        message: "Votre compte et vos clés ont été supprimés avec succès."
      });
    } catch (err) {
      console.error("[Delete Account Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ----------------------------------------------------
  // ACTION 5 : PROFIL & CRÉDITS (ME)
  // ----------------------------------------------------
  if (action === "me" || action === "profile") {
    try {
      const auth = await security.authenticateRequest(req);
      if (!auth.authorized) {
        return res.status(401).json({
          error: auth.reason || "Non authentifié : Clé API manquante ou invalide."
        });
      }

      return res.status(200).json({
        status: "authenticated",
        user: auth.user,
        is_admin: auth.is_admin,
        api_key: auth.key
      });
    } catch (err) {
      console.error("[Auth Me Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ----------------------------------------------------
  // ACTION 6 : ÉTAT DU CLUSTER (PAR DÉFAUT)
  // ----------------------------------------------------
  if (!security.checkRateLimit(req, 30)) {
    return res.status(429).json({ error: "Trop de requêtes. Veuillez patienter." });
  }

  try {
    const authorized = security.isAuthorized(req);
    const accounts = await turso.getActiveAccounts();
    const totalCredits = accounts.reduce((acc, a) => acc + parseInt(a.credits || 0, 10), 0);

    return res.status(200).json({
      status: "online",
      cluster: "Stanley Stawa Neural Cluster",
      active_accounts_count: accounts.length,
      max_pool_limit: security.MAX_ACCOUNT_POOL_LIMIT,
      total_credits_pool: totalCredits,
      accounts: accounts.map((a, idx) => ({
        node_id: `Node-${idx + 1}`,
        email: authorized ? a.email : `node-${idx + 1}***@cluster.internal`,
        credits: a.credits,
        status: a.status,
        created_at: a.created_at
      }))
    });
  } catch (err) {
    console.error("[API Accounts Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
