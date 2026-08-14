/**
 * api/stanleystawa/accounts.js — Authentification, Inscription Sécurisée, Quêtes WhatsApp Anti-Fraude & Panel Admin
 */

const url = require("url");
const turso = require("../../lib/turso");
const security = require("../../lib/security");
const mailer = require("../../lib/mailer");

const MAX_REGISTRATIONS_PER_GMAIL = 2;
const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/C21rwzKmQlA3nA1MppQ4oO";

/**
 * Récupère le code secret WhatsApp : Priorité à la variable Vercel WHATSAPP_SECRET_CODE
 */
async function getWhatsAppSecretCode() {
  if (process.env.WHATSAPP_SECRET_CODE && process.env.WHATSAPP_SECRET_CODE.trim()) {
    return process.env.WHATSAPP_SECRET_CODE.trim();
  }
  if (process.env.QUEST_SECRET_CODE && process.env.QUEST_SECRET_CODE.trim()) {
    return process.env.QUEST_SECRET_CODE.trim();
  }
  const dbCode = await turso.getSetting("whatsapp_secret_code");
  if (dbCode) return dbCode;
  return "STAWA-VIP-2026";
}

const QUESTS_LIST = [
  {
    id: "join_whatsapp",
    title: "Rejoindre le Groupe WhatsApp VIP",
    description: "Rejoignez le groupe WhatsApp officiel et entrez le code secret situé dans la description du groupe.",
    reward_studio: 15,
    reward_dev: 10,
    type: "one_time",
    verification_type: "secret_code_and_phone",
    action_url: WHATSAPP_GROUP_URL,
    button_text: "Valider avec le Code Secret (+15)",
    badge: "Vérification Unique"
  },
  {
    id: "share_whatsapp",
    title: "Partage Statut & Groupes WhatsApp",
    description: "Partagez l'invitation sur votre statut WhatsApp et renseignez votre numéro pour valider votre preuve.",
    reward_studio: 5,
    reward_dev: 3,
    type: "daily",
    verification_type: "phone_proof",
    button_text: "Partager & Valider (+5/j)",
    badge: "Quotidien (+5/j)"
  },
  {
    id: "share_video",
    title: "Défi Créateur ★ Stanley stawa",
    description: "Générez au moins une vidéo complète sur la plateforme pour valider automatiquement ce défi.",
    reward_studio: 5,
    reward_dev: 3,
    type: "daily",
    verification_type: "video_generation_check",
    button_text: "Vérifier ma Création (+5)",
    badge: "Preuve IA"
  },
  {
    id: "daily_checkin",
    title: "Bonus de Présence Journalière",
    description: "Connectez-vous chaque jour sur le studio pour récupérer vos crédits gratuits et maintenir votre streak.",
    reward_studio: 2,
    reward_dev: 1,
    type: "daily",
    verification_type: "instant",
    button_text: "Récupérer mon bonus (+2)",
    badge: "Tous les jours"
  }
];

function readBody(req) {
  if (req.body) {
    if (typeof req.body === "object") return Promise.resolve(req.body);
    if (typeof req.body === "string") {
      try {
        return Promise.resolve(JSON.parse(req.body));
      } catch {
        return Promise.resolve({});
      }
    }
  }
  if (!req.on || typeof req.on !== "function" || req.readableEnded || req.complete) {
    return Promise.resolve({});
  }
  return new Promise((resolve) => {
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
    setTimeout(() => resolve({}), 250);
  });
}

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const clientIp = security.getClientIp(req);
  const parsedUrlQuery = url.parse(req.url || "", true).query || {};
  const query = { ...parsedUrlQuery, ...(req.query || {}) };
  const body = req.method === "POST" ? await readBody(req) : {};
  const params = { ...query, ...body };
  const action = String(params.action || query.action || body.action || "").toLowerCase();

  // ====================================================
  // ACTIONS ADMINISTRATEUR (PANEL ADMIN SECURISE)
  // ====================================================

  if (action.startsWith("admin_")) {
    const auth = await security.authenticateRequest(req);
    if (!auth.authorized || !auth.is_admin) {
      return res.status(403).json({ error: "Accès refusé : Seul le compte administrateur officiel peut accéder à cette section." });
    }

    // 1. Statistiques globales
    if (action === "admin_stats") {
      try {
        const stats = await turso.getSystemStats();
        const secretCode = await getWhatsAppSecretCode();
        return res.status(200).json({ status: "success", stats, whatsapp_secret_code: secretCode });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 2. Liste des utilisateurs
    if (action === "admin_users") {
      try {
        const users = await turso.getAllUsers(100);
        return res.status(200).json({ status: "success", users });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 3. Modifier les crédits d'un utilisateur
    if (action === "admin_update_credits") {
      const target = params.email || params.user_id || params.id;
      const credits = parseInt(params.credits, 10);
      if (!target || isNaN(credits)) {
        return res.status(400).json({ error: "Paramètres 'email' (ou 'user_id') et 'credits' requis." });
      }
      try {
        await turso.updateUserCredits(target, credits);
        return res.status(200).json({ status: "success", message: `Crédits mis à jour : ${credits} crédits pour ${target}.` });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 4. Supprimer un utilisateur
    if (action === "admin_delete_user") {
      const target = params.email || params.user_id || params.id;
      if (!target) return res.status(400).json({ error: "Paramètre 'email' ou 'user_id' requis." });
      try {
        await turso.deleteUserByAdmin(target);
        return res.status(200).json({ status: "success", message: `Utilisateur ${target} supprimé.` });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 5. Liste des tâches vidéo
    if (action === "admin_tasks") {
      try {
        const tasks = await turso.getRecentTasks(50);
        return res.status(200).json({ status: "success", tasks });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 6. Supprimer une tâche vidéo
    if (action === "admin_delete_task") {
      const taskId = params.task_id || params.taskId;
      if (!taskId) return res.status(400).json({ error: "Paramètre 'task_id' requis." });
      try {
        await turso.deleteTask(taskId);
        return res.status(200).json({ status: "success", message: `Tâche ${taskId} supprimée.` });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 7. Liste détaillée des nœuds de calcul du cluster
    if (action === "admin_cluster_nodes") {
      try {
        const nodes = await turso.getAllAccountsDetailed();
        return res.status(200).json({ status: "success", nodes });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 8. Nettoyage des nœuds à 0 crédit
    if (action === "admin_clean_nodes") {
      try {
        await turso.cleanDeadAccounts();
        return res.status(200).json({ status: "success", message: "Nœuds inactifs ou à 0 crédit nettoyés avec succès." });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 9. Journal des réclamations de quêtes (Audit Anti-Fraude)
    if (action === "admin_quest_claims") {
      try {
        const claims = await turso.getAllQuestClaims(100);
        return res.status(200).json({ status: "success", claims });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 10. Modifier le Code Secret du Groupe WhatsApp
    if (action === "admin_set_quest_code") {
      const newCode = String(params.code || params.secret_code || "").trim();
      if (!newCode || newCode.length < 3) {
        return res.status(400).json({ error: "Veuillez fournir un code secret d'au moins 3 caractères." });
      }
      try {
        await turso.setSetting("whatsapp_secret_code", newCode);
        return res.status(200).json({ status: "success", message: `Code secret WhatsApp mis à jour : ${newCode}` });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 11. Liste de toutes les quêtes personnalisées
    if (action === "admin_get_quests") {
      try {
        const quests = await turso.getCustomQuests(false);
        return res.status(200).json({ status: "success", quests });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 12. Créer / Mettre à jour une quête personnalisée
    if (action === "admin_create_quest") {
      try {
        const result = await turso.createCustomQuest(params);
        return res.status(200).json({ status: "success", message: "Quête enregistrée avec succès !", result });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 13. Activer / Désactiver une quête personnalisée
    if (action === "admin_toggle_quest") {
      const target = params.quest_id || params.id || params.key;
      if (!target) return res.status(400).json({ error: "Paramètre 'quest_id' requis." });
      try {
        await turso.toggleCustomQuest(target);
        return res.status(200).json({ status: "success", message: "Statut de la quête modifié." });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 14. Supprimer une quête personnalisée
    if (action === "admin_delete_quest") {
      const target = params.quest_id || params.id || params.key;
      if (!target) return res.status(400).json({ error: "Paramètre 'quest_id' requis." });
      try {
        await turso.deleteCustomQuest(target);
        return res.status(200).json({ status: "success", message: "Quête supprimée avec succès." });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 15. Distribution de crédits en masse (Airdrop promotionnel)
    if (action === "admin_bulk_credits") {
      const amount = parseInt(params.amount || params.credits, 10);
      const roleFilter = String(params.role_filter || "all").toLowerCase();
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Montant de crédits positif requis." });
      }
      try {
        const result = await turso.bulkAddCredits(amount, roleFilter);
        return res.status(200).json({ status: "success", message: `Airdrop de +${amount} crédits distribué avec succès !`, result });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 16. Révoquer une réclamation de quête frauduleuse
    if (action === "admin_revoke_claim") {
      const claimId = params.claim_id || params.id;
      if (!claimId) return res.status(400).json({ error: "Paramètre 'claim_id' requis." });
      try {
        const result = await turso.revokeQuestClaim(claimId);
        if (!result.success) return res.status(404).json({ error: result.error });
        return res.status(200).json({ status: "success", message: `Réclamation #${claimId} révoquée. -${result.revoked_credits} crédits déduits de ${result.user_email}.` });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 17. Purger les anciennes tâches vidéo
    if (action === "admin_purge_stale_tasks") {
      const days = parseInt(params.days || "7", 10);
      try {
        await turso.purgeStaleTasks(days);
        return res.status(200).json({ status: "success", message: `Tâches de plus de ${days} jours purgées avec succès.` });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 18. Journal d'activité système
    if (action === "admin_activity_log") {
      try {
        const logs = await turso.getRecentActivity(50);
        return res.status(200).json({ status: "success", logs });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 19. Exportation de données
    if (action === "admin_export_data") {
      const type = String(params.type || "users").toLowerCase();
      try {
        const data = await turso.exportData(type);
        return res.status(200).json({ status: "success", type, count: data.length, data });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // 20. Bannière d'annonce / Message d'alerte en direct
    if (action === "admin_set_broadcast") {
      const message = String(params.message || params.text || "").trim();
      try {
        await turso.setSetting("broadcast_banner", message);
        return res.status(200).json({ status: "success", message: "Bannière d'annonce mise à jour avec succès !" });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  }

  // ====================================================
  // ACTIONS UTILISATEUR (AUTHENTIFICATION & QUÊTES SÉCURISÉES)
  // ====================================================

  // 1. Envoi OTP (Inscription & Connexion Sécurisée)
  if (action === "send_otp" || action === "sendotp" || action === "otp") {
    if (!security.checkRateLimit(req, 15)) {
      return res.status(429).json({ error: "Trop de demandes d'OTP. Veuillez patienter une minute." });
    }

    const rawEmail = (params.email || "").trim().toLowerCase();
    const canonicalEmail = security.canonicalizeEmail(rawEmail);
    const purpose = String(params.purpose || params.type || "auth").toLowerCase();
    const isExempt = security.isExemptFromLimits(rawEmail) || security.isExemptFromLimits(canonicalEmail);

    if (!rawEmail || !rawEmail.includes("@") || !rawEmail.includes(".")) {
      return res.status(400).json({ error: "Veuillez saisir une adresse Gmail valide." });
    }

    if (!isExempt && (mailer.isDisposableEmail(rawEmail) || mailer.isDisposableEmail(canonicalEmail))) {
      return res.status(400).json({
        error: "Les adresses e-mails temporaires ou jetables sont strictement interdites. Utilisez une vraie adresse Gmail."
      });
    }

    try {
      if (!isExempt && purpose === "register") {
        const isDeleted = await turso.isEmailPermanentlyDeleted(canonicalEmail);
        if (isDeleted) {
          return res.status(403).json({
            error: "Ce compte Gmail a été définitivement supprimé. Conformément aux règles de sécurité, vous ne pouvez plus créer de compte avec cette adresse."
          });
        }

        const regCount = await turso.getEmailRegistrationCount(canonicalEmail);
        if (regCount >= MAX_REGISTRATIONS_PER_GMAIL) {
          return res.status(403).json({
            error: `Limite maximale atteinte : Cette adresse Gmail a déjà été utilisée ${regCount} fois pour créer un compte (maximum autorisé : ${MAX_REGISTRATIONS_PER_GMAIL} fois).`
          });
        }
      }

      // Générer et enregistrer l'OTP (valable 10 minutes)
      const otpCode = mailer.generateOtp();
      await turso.saveOtp(canonicalEmail, otpCode, 10);

      const sendResult = await mailer.sendOtpEmail(rawEmail, otpCode);

      if (!sendResult.sent) {
        return res.status(500).json({
          error: sendResult.error || "Impossible d'expédier l'e-mail de vérification. Vérifiez votre adresse Gmail."
        });
      }

      const isTester = security.isUnlimitedTesterEmail(rawEmail) || security.isUnlimitedTesterEmail(canonicalEmail);
      const regCount = await turso.getEmailRegistrationCount(canonicalEmail);
      
      const successMsg = (isTester && sendResult.note)
        ? `Code de vérification : ${otpCode} (Expédié à ${rawEmail})`
        : `Code de vérification expédié à ${rawEmail} ! Consultez votre boîte Gmail.`;

      return res.status(200).json({
        status: "success",
        message: successMsg,
        email: rawEmail,
        creations_used: regCount,
        max_creations: isExempt ? "Illimité" : MAX_REGISTRATIONS_PER_GMAIL,
        expires_in: "10 minutes"
      });
    } catch (err) {
      console.error("[Send OTP Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. Inscription
  if (action === "register" || action === "signup") {
    if (!security.checkRateLimit(req, 15)) {
      return res.status(429).json({ error: "Trop de tentatives d'inscription. Veuillez patienter." });
    }

    const rawEmail = (params.email || "").trim().toLowerCase();
    const canonicalEmail = security.canonicalizeEmail(rawEmail);
    const password = String(params.password || "").trim();
    const otp = String(params.otp || params.code || params.otp_code || "").trim();
    const accountType = (params.account_type || params.accountType || "studio").toLowerCase();
    const referralCode = String(params.ref || params.referral || params.referrer || "").trim().toLowerCase();
    const isExempt = security.isExemptFromLimits(rawEmail) || security.isExemptFromLimits(canonicalEmail);
    const isAdm = security.isAdminEmail(rawEmail) || security.isAdminEmail(canonicalEmail);

    if (!rawEmail || !rawEmail.includes("@") || !rawEmail.includes(".")) {
      return res.status(400).json({ error: "Adresse e-mail valide requise." });
    }

    if (!isExempt && (mailer.isDisposableEmail(rawEmail) || mailer.isDisposableEmail(canonicalEmail))) {
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
      if (!isExempt) {
        const isDeleted = await turso.isEmailPermanentlyDeleted(canonicalEmail);
        if (isDeleted) {
          return res.status(403).json({
            error: "Ce compte Gmail a été définitivement fermé après suppression. La réinscription avec cette adresse est strictement interdite."
          });
        }

        const regCount = await turso.getEmailRegistrationCount(canonicalEmail);
        if (regCount >= MAX_REGISTRATIONS_PER_GMAIL) {
          return res.status(403).json({
            error: `Limite maximale atteinte : Cette adresse Gmail a déjà été utilisée ${regCount} fois pour créer un compte (maximum autorisé : ${MAX_REGISTRATIONS_PER_GMAIL} fois).`
          });
        }
      }

      const otpValidation = await turso.verifyOtp(canonicalEmail, otp);
      if (!otpValidation.valid) {
        return res.status(400).json({
          error: otpValidation.reason || "Code OTP incorrect ou expiré."
        });
      }

      const existing = await turso.getUserByEmail(canonicalEmail) || await turso.getUserByEmail(rawEmail);
      if (existing) {
        if (!isExempt) {
          return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail." });
        } else {
          // Si compte exempté ré-inscrit, mise à jour sécurisée
          const passwordHash = security.hashPassword(password);
          const credits = isAdm ? 999999 : (existing.credits || 30);
          const role = isAdm ? "admin" : "user";
          await turso.execute(`UPDATE users SET password_hash = ?, credits = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?);`, [passwordHash, credits, role, canonicalEmail]);
          return res.status(200).json({
            status: "success",
            message: `Compte mis à jour avec succès ${isAdm ? '(Admin)' : '(Testeur)'} !`,
            user: {
              email: canonicalEmail,
              api_key: existing.api_key,
              credits,
              role,
              account_type: existing.account_type || accountType
            }
          });
        }
      }

      const passwordHash = security.hashPassword(password);
      const userApiKey = security.generateUserApiKey();
      
      let welcomeCredits = isAdm ? 999999 : 30;
      let wasReferred = false;

      if (!isAdm && referralCode && referralCode.includes("@")) {
        const canonicalReferrer = security.canonicalizeEmail(referralCode);
        const referrerUser = await turso.getUserByEmail(canonicalReferrer);
        if (referrerUser && canonicalReferrer !== canonicalEmail) {
          welcomeCredits = 35; // +35 crédits pour le filleul
          wasReferred = true;
          await turso.recordReferral(canonicalReferrer, canonicalEmail, referrerUser.account_type === "developer" ? 5 : 10);
        }
      }

      const role = isAdm ? "admin" : "user";
      const user = await turso.createUser(canonicalEmail, passwordHash, userApiKey, welcomeCredits, role, accountType);
      const regCount = await turso.getEmailRegistrationCount(canonicalEmail);

      return res.status(201).json({
        status: "success",
        message: `E-mail vérifié et compte créé avec succès ! ${welcomeCredits} crédits offerts ${wasReferred ? '(Bonus Parrainage inclus !)' : ''} ${isExempt ? '(Non limité)' : `(Création ${regCount}/${MAX_REGISTRATIONS_PER_GMAIL})`}.`,
        user: {
          email: user.email,
          api_key: user.api_key,
          credits: user.credits,
          role: user.role,
          account_type: user.account_type
        }
      });
    } catch (err) {
      console.error("[Register Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 3. Connexion (Par Mot de Passe OU par Code OTP par E-mail)
  if (action === "login" || action === "signin") {
    if (security.isIpLockedOut(clientIp)) {
      return res.status(429).json({
        error: "Trop d'échecs de connexion consécutifs. Votre accès est temporairement bloqué pendant 15 minutes par sécurité."
      });
    }

    const rawEmail = (params.email || "").trim().toLowerCase();
    const canonicalEmail = security.canonicalizeEmail(rawEmail);
    const password = String(params.password || "").trim();
    const otp = String(params.otp || params.code || params.otp_code || "").trim();

    if (!rawEmail) {
      return res.status(400).json({ error: "Adresse e-mail requise." });
    }

    if (!password && !otp) {
      return res.status(400).json({ error: "Veuillez entrer votre mot de passe OU votre code OTP reçu par e-mail." });
    }

    try {
      const user = await turso.getUserByEmail(canonicalEmail) || await turso.getUserByEmail(rawEmail);
      if (!user) {
        security.recordLoginAttempt(clientIp, false);
        return res.status(401).json({ error: "Aucun compte actif trouvé avec cette adresse e-mail. Veuillez d'abord cliquer sur 'Inscription' pour créer votre compte." });
      }

      // 1. Connexion par Code OTP (Sans mot de passe / Récupération)
      if (otp) {
        const otpValidation = await turso.verifyOtp(canonicalEmail, otp);
        if (!otpValidation.valid) {
          return res.status(400).json({ error: otpValidation.reason || "Code OTP incorrect ou expiré." });
        }
      } else {
        // 2. Connexion par Mot de Passe
        const passwordHash = security.hashPassword(password);
        if (user.password_hash !== passwordHash) {
          security.recordLoginAttempt(clientIp, false);
          return res.status(401).json({ error: "Mot de passe incorrect. Vous pouvez aussi vous connecter sans mot de passe en utilisant l'onglet 'Code OTP par E-mail'." });
        }
      }

      security.recordLoginAttempt(clientIp, true);
      const isAdm = user.role === "admin" || security.isAdminEmail(user.email);

      return res.status(200).json({
        status: "success",
        message: "Connexion réussie !",
        user: {
          id: user.id,
          email: user.email,
          api_key: user.api_key,
          credits: isAdm ? 999999 : parseInt(user.credits || 0, 10),
          role: isAdm ? "admin" : "user",
          account_type: user.account_type || "studio"
        }
      });
    } catch (err) {
      console.error("[Login Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 4. Conversion Compte Studio -> Compte Développeur (Génération de Clé API avec sacrifice)
  if (action === "convert_to_developer" || action === "convert" || action === "upgrade_dev") {
    try {
      const auth = await security.authenticateRequest(req);
      if (!auth.authorized || !auth.user) {
        return res.status(401).json({ error: "Authentification requise pour convertir votre compte." });
      }

      const result = await turso.convertToDeveloperAccount(auth.key, 5);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      return res.status(200).json({
        status: "success",
        message: `Félicitations ! Votre compte a été converti en Compte Développeur (-5 crédits). Votre clé API personnelle est désormais active pour vos scripts et bots.`,
        user: {
          email: auth.user.email,
          account_type: "developer",
          api_key: result.api_key,
          credits: result.credits,
          role: auth.user.role
        }
      });
    } catch (err) {
      console.error("[Convert Account Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 5. État des Quêtes & Récompenses
  if (action === "quests" || action === "quests_status" || action === "get_quests") {
    let authUser = null;
    let isAdm = false;
    let accountType = "studio";
    let claims = [];
    let refStats = { count: 0, total_earned: 0 };
    let inviteesList = [];
    const today = new Date().toISOString().split("T")[0];

    const auth = await security.authenticateRequest(req);
    if (auth.authorized && auth.user) {
      authUser = auth.user;
      isAdm = auth.is_admin;
      accountType = auth.user.account_type || "studio";
      try {
        claims = await turso.getUserQuests(authUser.email);
        refStats = await turso.getReferralStats(authUser.email);
        inviteesList = await turso.getReferralsList(authUser.email);
      } catch (err) {
        console.warn("[Quests fetch error]", err);
      }
    } else {
      const email = params.email ? security.canonicalizeEmail(params.email) : null;
      if (email) {
        const u = await turso.getUserByEmail(email);
        if (u) {
          authUser = u;
          accountType = u.account_type || "studio";
          claims = await turso.getUserQuests(u.email);
          refStats = await turso.getReferralStats(u.email);
          inviteesList = await turso.getReferralsList(u.email);
        }
      }
    }

    let allQuests = [...QUESTS_LIST];
    try {
      const dbQuests = await turso.getCustomQuests(true);
      if (dbQuests && dbQuests.length) {
        dbQuests.forEach(dq => {
          const idx = allQuests.findIndex(q => q.id === dq.quest_key);
          const mapped = {
            id: dq.quest_key,
            title: dq.title,
            description: dq.description,
            reward_studio: parseInt(dq.reward_studio, 10) || 15,
            reward_dev: parseInt(dq.reward_dev, 10) || 10,
            type: dq.quest_type || "one_time",
            verification_type: dq.verification_type || "instant",
            action_url: dq.action_url || "",
            button_text: dq.button_text || "Valider",
            badge: dq.badge || "Bonus"
          };
          if (idx !== -1) {
            allQuests[idx] = mapped;
          } else {
            allQuests.push(mapped);
          }
        });
      }
    } catch (e) {
      console.warn("DB quests fetch error:", e);
    }

    const processedQuests = allQuests.map(q => {
      const reward = accountType === "developer" ? q.reward_dev : q.reward_studio;
      let claimed = false;
      let canClaim = true;
      let lastClaimedDate = null;
      let claimedPhone = null;

      if (authUser) {
        if (q.type === "one_time") {
          const match = claims.find(c => c.quest_id === q.id);
          claimed = Boolean(match);
          canClaim = !claimed;
          if (match) claimedPhone = match.whatsapp_number;
        } else if (q.type === "daily") {
          const todayClaim = claims.find(c => c.quest_id === q.id && c.claimed_date === today);
          claimed = Boolean(todayClaim);
          canClaim = !claimed;
          const anyClaim = claims.find(c => c.quest_id === q.id);
          if (anyClaim) lastClaimedDate = anyClaim.claimed_date;
        }
      }

      return {
        id: q.id,
        title: q.title,
        description: q.description,
        reward,
        reward_studio: q.reward_studio,
        reward_dev: q.reward_dev,
        type: q.type,
        verification_type: q.verification_type,
        action_url: q.action_url,
        button_text: q.button_text,
        badge: q.badge,
        claimed,
        can_claim: canClaim,
        last_claimed_date: lastClaimedDate,
        claimed_phone: claimedPhone
      };
    });

    const totalClaimedCount = claims.length;
    const totalBonusEarned = claims.reduce((acc, c) => acc + parseInt(c.reward_credits || 0, 10), 0) + refStats.total_earned;

    return res.status(200).json({
      status: "success",
      authenticated: Boolean(authUser),
      user: authUser ? {
        email: authUser.email,
        account_type: accountType,
        credits: authUser.credits,
        is_admin: isAdm
      } : null,
      account_type: accountType,
      whatsapp_group_url: WHATSAPP_GROUP_URL,
      referral: {
        referral_code: authUser?.email || "",
        referral_url: authUser ? `https://magiclight-api.vercel.app/?ref=${encodeURIComponent(authUser.email)}` : `https://magiclight-api.vercel.app/`,
        invited_count: refStats.count,
        total_earned_credits: refStats.total_earned,
        reward_per_invite: accountType === "developer" ? 5 : 10,
        invitee_welcome_bonus: 35,
        invitees: inviteesList
      },
      quests: processedQuests,
      summary: {
        total_quests_completed: totalClaimedCount,
        total_bonus_earned: totalBonusEarned
      }
    });
  }

  // 6. VALIDATION SÉCURISÉE & VÉRIFICATION RÉELLE D'UNE QUÊTE
  if (action === "claim_quest" || action === "claimquest" || action === "claim") {
    const auth = await security.authenticateRequest(req);
    if (!auth.authorized || !auth.user) {
      return res.status(401).json({
        error: "Authentification requise : Veuillez vous connecter pour valider et réclamer vos quêtes."
      });
    }

    const questId = String(params.quest_id || params.quest || "").trim().toLowerCase();
    let quest = QUESTS_LIST.find(q => q.id === questId);
    if (!quest) {
      try {
        const dbQuests = await turso.getCustomQuests(false);
        const match = dbQuests.find(dq => dq.quest_key === questId);
        if (match) {
          quest = {
            id: match.quest_key,
            title: match.title,
            description: match.description,
            reward_studio: parseInt(match.reward_studio, 10) || 15,
            reward_dev: parseInt(match.reward_dev, 10) || 10,
            type: match.quest_type || "one_time",
            verification_type: match.verification_type || "instant",
            action_url: match.action_url || "",
            button_text: match.button_text || "Valider",
            badge: match.badge || "Bonus"
          };
        }
      } catch (e) {}
    }

    if (!quest) {
      return res.status(404).json({
        error: `Quête inconnue (${questId}).`
      });
    }

    const user = auth.user;
    const accountType = user.account_type || "studio";
    const reward = accountType === "developer" ? quest.reward_dev : quest.reward_studio;
    const today = new Date().toISOString().split("T")[0];
    const submittedPhone = String(params.whatsapp_number || params.phone || "").trim();
    const submittedSecret = String(params.secret_code || params.code || params.secret || "").trim();

    try {
      // 1. Vérification anti-doublon générale
      if (quest.type === "one_time") {
        const already = await turso.hasClaimedQuest(user.email, quest.id);
        if (already) {
          return res.status(400).json({
            error: `Vous avez déjà validé la quête "${quest.title}".`
          });
        }
      } else if (quest.type === "daily") {
        const alreadyToday = await turso.hasClaimedQuest(user.email, quest.id, today);
        if (alreadyToday) {
          return res.status(400).json({
            error: `Vous avez déjà validé cette quête aujourd'hui. Revenez demain !`
          });
        }
      }

      // 2. VÉRIFICATION STRICTE DE LA QUÊTE #1 : REJOINDRE LE GROUPE WHATSAPP
      if (quest.id === "join_whatsapp") {
        const digitsPhone = submittedPhone.replace(/[^0-9]/g, "");
        if (!digitsPhone || digitsPhone.length < 8) {
          return res.status(400).json({
            error: "Numéro WhatsApp invalide. Veuillez renseigner votre vrai numéro WhatsApp (ex: +229 97 00 00 00) avec indicatif pays."
          });
        }

        // Vérification stricte d'unicité absolue du numéro WhatsApp dans toute la base de données
        const phoneAlreadyUsed = await turso.hasWhatsAppNumberClaimed(digitsPhone, "join_whatsapp");
        if (phoneAlreadyUsed) {
          return res.status(403).json({
            error: `Sécurité anti-fraude : Le numéro WhatsApp ${submittedPhone} a déjà été utilisé pour valider cette quête. Un numéro WhatsApp ne peut être utilisé qu'une seule fois.`
          });
        }

        if (!submittedSecret) {
          return res.status(400).json({
            error: "Code Secret VIP manquant ! Veuillez rejoindre le groupe WhatsApp officiel et consulter la description ou le message épinglé pour trouver le code secret."
          });
        }

        const validSecret = await getWhatsAppSecretCode();
        const cleanSub = submittedSecret.trim();
        const cleanVal = validSecret.trim();
        if (cleanSub !== cleanVal && cleanSub.toLowerCase() !== cleanVal.toLowerCase()) {
          return res.status(400).json({
            error: `Code Secret incorrect ! Rejoignez le groupe WhatsApp officiel (${WHATSAPP_GROUP_URL}) pour lire la description et obtenir le vrai code VIP.`
          });
        }
      }

      // 3. VÉRIFICATION STRICTE DE LA QUÊTE #2 : PARTAGE STATUT WHATSAPP
      if (quest.id === "share_whatsapp") {
        const digitsPhone = submittedPhone.replace(/[^0-9]/g, "");
        if (!digitsPhone || digitsPhone.length < 8) {
          return res.status(400).json({
            error: "Veuillez renseigner votre numéro WhatsApp ayant partagé le statut."
          });
        }
      }

      // 4. VÉRIFICATION STRICTE DE LA QUÊTE #3 : CRÉATION RÉELLE D'UNE VIDÉO SUR LA PLATEFORME
      if (quest.id === "share_video") {
        const hasCompletedVideo = await turso.hasUserCompletedVideo(user.email);
        if (!hasCompletedVideo) {
          return res.status(400).json({
            error: "Vérification échouée : Vous n'avez pas encore généré de vidéo finalisée. Veuillez créer votre première vidéo dans l'onglet 'Vidéo Studio' pour valider ce défi !"
          });
        }
      }

      // 5. Validation et Crédit
      const newCredits = await turso.claimQuest(
        user.email,
        quest.id,
        reward,
        today,
        submittedPhone,
        submittedSecret || "verified_ok"
      );

      return res.status(200).json({
        status: "success",
        message: `Vérification réussie ! Quête "${quest.title}" validée avec succès. +${reward} crédits ajoutés à votre compte !`,
        reward_credited: reward,
        new_credits: newCredits,
        quest_id: quest.id,
        user_email: user.email,
        account_type: accountType
      });

    } catch (err) {
      console.error("[Claim Quest Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 7. Suppression de compte (Verrouillage Définitif de l'adresse Gmail)
  if (action === "delete_account" || action === "delete" || action === "deleteaccount") {
    try {
      const auth = await security.authenticateRequest(req);
      if (!auth.authorized || !auth.user) {
        return res.status(401).json({ error: "Authentification requise pour supprimer votre compte." });
      }

      if (auth.is_admin && auth.key.startsWith("stanleystawa_live_")) {
        return res.status(400).json({ error: "Le compte administrateur maître ne peut pas être supprimé." });
      }

      const emailToDelete = auth.user.email;
      const canonicalEmail = security.canonicalizeEmail(emailToDelete);

      const deleted = await turso.deleteUserAccount(auth.key);
      if (!deleted) {
        return res.status(404).json({ error: "Compte introuvable ou déjà supprimé." });
      }

      // Verrouillage définitif de l'adresse Gmail (interdit toute réinscription future)
      if (!security.isExemptFromLimits(emailToDelete) && !security.isExemptFromLimits(canonicalEmail)) {
        await turso.markEmailDeletedPermanently(canonicalEmail);
      }

      return res.status(200).json({
        status: "success",
        message: "Votre compte et vos clés ont été supprimés définitivement. Conformément aux règles de sécurité, cette adresse Gmail ne pourra plus être réutilisée."
      });
    } catch (err) {
      console.error("[Delete Account Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 8. Profil & Crédits (Me)
  if (action === "me" || action === "profile") {
    try {
      const auth = await security.authenticateRequest(req);
      if (!auth.authorized) {
        return res.status(401).json({
          error: auth.reason || "Non authentifié : Clé API manquante ou invalide."
        });
      }

      const refStats = await turso.getReferralStats(auth.user.email);
      const userQuests = await turso.getUserQuests(auth.user.email);

      return res.status(200).json({
        status: "authenticated",
        user: {
          ...auth.user,
          referrals_count: refStats.count,
          quests_completed_count: userQuests.length
        },
        is_admin: auth.is_admin,
        api_key: auth.key
      });
    } catch (err) {
      console.error("[Auth Me Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 9. État du Cluster (Par défaut)
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
