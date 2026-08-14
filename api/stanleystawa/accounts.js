/**
 * api/stanleystawa/accounts.js — Gestion Complète Authentification, Inscription & Cluster Turso
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

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

  const query = req.query || {};
  const body = req.method === "POST" ? await readBody(req) : {};
  const params = { ...query, ...body };
  const action = String(params.action || query.action || "").toLowerCase();

  // ----------------------------------------------------
  // ACTION 1 : INSCRIPTION (REGISTER + 100 CRÉDITS)
  // ----------------------------------------------------
  if (action === "register" || action === "signup") {
    if (!security.checkRateLimit(req, 10)) {
      return res.status(429).json({ error: "Trop de tentatives d'inscription. Veuillez patienter." });
    }

    const email = (params.email || "").trim().toLowerCase();
    const password = String(params.password || "").trim();

    if (!email || !email.includes("@") || !email.includes(".")) {
      return res.status(400).json({ error: "Adresse e-mail valide requise." });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
    }

    try {
      const existing = await turso.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail. Veuillez vous connecter." });
      }

      const passwordHash = security.hashPassword(password);
      const userApiKey = security.generateUserApiKey();
      const welcomeCredits = 100;

      const user = await turso.createUser(email, passwordHash, userApiKey, welcomeCredits, "user");

      return res.status(201).json({
        status: "success",
        message: "Compte créé avec succès ! 100 crédits de bienvenue offerts.",
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
  // ACTION 2 : CONNEXION (LOGIN)
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
        return res.status(401).json({ error: "Identifiants incorrects (aucun compte avec cet e-mail)." });
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
  // ACTION 3 : PROFIL & CRÉDITS (ME)
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
  // ACTION 4 : ÉTAT DU CLUSTER (PAR DÉFAUT)
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
