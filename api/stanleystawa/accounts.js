/**
 * api/stanleystawa/accounts.js — Authentification, Inscription Sécurisée, Quêtes Communauté WhatsApp & Panel Admin
 */

const url = require("url");
const turso = require("../../lib/turso");
const security = require("../../lib/security");
const mailer = require("../../lib/mailer");

const MAX_REGISTRATIONS_PER_GMAIL = 2;
const WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/C21rwzKmQlA3nA1MppQ4oO";

const QUESTS_LIST = [
  {
    id: "join_whatsapp",
    title: "Rejoindre le Groupe WhatsApp VIP",
    description: "Rejoignez la communauté officielle WhatsApp pour recevoir des prompts d'or, mises à jour et échanger avec les créateurs.",
    reward_studio: 50,
    reward_dev: 20,
    type: "one_time",
    action_type: "link",
    action_url: WHATSAPP_GROUP_URL,
    button_text: "Rejoindre le Groupe (+50 Crédits)",
    badge: "Indispensable"
  },
  {
    id: "share_whatsapp",
    title: "Partage Statut & Groupes WhatsApp",
    description: "Partagez la plateforme et le groupe WhatsApp sur votre statut ou vos groupes pour faire découvrir Stanley Stawa AI.",
    reward_studio: 25,
    reward_dev: 10,
    type: "daily",
    action_type: "share_whatsapp",
    button_text: "Partager sur WhatsApp (+25 Crédits)",
    badge: "Quotidien (+25/j)"
  },
  {
    id: "daily_checkin",
    title: "Bonus de Présence Quotidienne",
    description: "Connectez-vous chaque jour sur le studio pour récupérer vos crédits gratuits et maintenir votre streak.",
    reward_studio: 10,
    reward_dev: 5,
    type: "daily",
    action_type: "claim_instant",
    button_text: "Récupérer mon bonus (+10 Crédits)",
    badge: "Tous les jours"
  },
  {
    id: "share_video",
    title: "Défi Créateur ★ Stanley stawa",
    description: "Générez et partagez une vidéo portant le filigrane officiel avec vos amis ou sur vos réseaux.",
    reward_studio: 20,
    reward_dev: 10,
    type: "daily",
    action_type: "claim_instant",
    button_text: "Valider ma création (+20 Crédits)",
    badge: "Créateur"
  }
];

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
      return res.status(403).json({ error: "Accès refusé : Seul le compte administrateur associé à l'e-mail officiel peut accéder à cette section." });
    }

    // 1. Statistiques globales
    if (action === "admin_stats") {
      try {
        const stats = await turso.getSystemStats();
        return res.status(200).json({ status: "success", stats });
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
  }

  // ====================================================
  // ACTIONS UTILISATEUR (AUTHENTIFICATION & QUÊTES)
  // ====================================================

  // 1. Envoi OTP
  if (action === "send_otp" || action === "sendotp" || action === "otp") {
    if (!security.checkRateLimit(req, 6)) {
      return res.status(429).json({ error: "Trop de demandes d'OTP. Veuillez patienter une minute." });
    }

    const rawEmail = (params.email || "").trim().toLowerCase();
    const canonicalEmail = security.canonicalizeEmail(rawEmail);

    if (!rawEmail || !rawEmail.includes("@") || !rawEmail.includes(".")) {
      return res.status(400).json({ error: "Veuillez saisir une adresse e-mail valide." });
    }

    if (mailer.isDisposableEmail(rawEmail) || mailer.isDisposableEmail(canonicalEmail)) {
      return res.status(400).json({
        error: "Les adresses e-mails temporaires ou jetables sont strictement interdites. Veuillez utiliser une vraie adresse Gmail, Outlook ou Yahoo."
      });
    }

    try {
      const regCount = await turso.getEmailRegistrationCount(canonicalEmail);
      if (regCount >= MAX_REGISTRATIONS_PER_GMAIL) {
        return res.status(403).json({
          error: `Limite maximale atteinte : Cette adresse Gmail a déjà été utilisée ${regCount} fois pour créer un compte (maximum autorisé : ${MAX_REGISTRATIONS_PER_GMAIL} fois).`
        });
      }

      const existing = await turso.getUserByEmail(canonicalEmail) || await turso.getUserByEmail(rawEmail);
      if (existing) {
        return res.status(409).json({ error: "Un compte actif existe déjà avec cette adresse e-mail. Veuillez vous connecter." });
      }

      const otpCode = mailer.generateOtp();
      await turso.saveOtp(canonicalEmail, otpCode, 10);

      const sendResult = await mailer.sendOtpEmail(rawEmail, otpCode);

      if (!sendResult.sent) {
        return res.status(500).json({
          error: sendResult.error || "Impossible d'expédier l'e-mail de vérification. Vérifiez votre adresse Gmail."
        });
      }

      return res.status(200).json({
        status: "success",
        message: `Code de vérification expédié à ${rawEmail} ! Vérifiez votre boîte Gmail.`,
        email: rawEmail,
        creations_used: regCount,
        max_creations: MAX_REGISTRATIONS_PER_GMAIL,
        expires_in: "10 minutes"
      });
    } catch (err) {
      console.error("[Send OTP Error]", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. Inscription
  if (action === "register" || action === "signup") {
    if (!security.checkRateLimit(req, 10)) {
      return res.status(429).json({ error: "Trop de tentatives d'inscription. Veuillez patienter." });
    }

    const rawEmail = (params.email || "").trim().toLowerCase();
    const canonicalEmail = security.canonicalizeEmail(rawEmail);
    const password = String(params.password || "").trim();
    const otp = String(params.otp || params.code || params.otp_code || "").trim();
    const accountType = (params.account_type || params.accountType || "studio").toLowerCase();
    const referralCode = String(params.ref || params.referral || params.referrer || "").trim().toLowerCase();

    if (!rawEmail || !rawEmail.includes("@") || !rawEmail.includes(".")) {
      return res.status(400).json({ error: "Adresse e-mail valide requise." });
    }

    if (mailer.isDisposableEmail(rawEmail) || mailer.isDisposableEmail(canonicalEmail)) {
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
      const regCount = await turso.getEmailRegistrationCount(canonicalEmail);
      if (regCount >= MAX_REGISTRATIONS_PER_GMAIL) {
        return res.status(403).json({
          error: `Limite maximale atteinte : Cette adresse Gmail a déjà été utilisée ${regCount} fois pour créer un compte (maximum autorisé : ${MAX_REGISTRATIONS_PER_GMAIL} fois).`
        });
      }

      const otpValidation = await turso.verifyOtp(canonicalEmail, otp);
      if (!otpValidation.valid) {
        return res.status(400).json({
          error: otpValidation.reason || "Code OTP incorrect ou expiré."
        });
      }

      const existing = await turso.getUserByEmail(canonicalEmail) || await turso.getUserByEmail(rawEmail);
      if (existing) {
        return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail." });
      }

      const passwordHash = security.hashPassword(password);
      const userApiKey = security.generateUserApiKey();
      const isAdm = security.isAdminEmail(rawEmail) || security.isAdminEmail(canonicalEmail);
      
      let welcomeCredits = isAdm ? 999999 : 30;
      let wasReferred = false;

      if (!isAdm && referralCode && referralCode.includes("@")) {
        const canonicalReferrer = security.canonicalizeEmail(referralCode);
        const referrerUser = await turso.getUserByEmail(canonicalReferrer);
        if (referrerUser && canonicalReferrer !== canonicalEmail) {
          welcomeCredits = 40; // Bonus +10 de bienvenue pour le nouveau filleul
          wasReferred = true;
          await turso.recordReferral(canonicalReferrer, canonicalEmail, referrerUser.account_type === "developer" ? 15 : 30);
        }
      }

      const role = isAdm ? "admin" : "user";
      const user = await turso.createUser(canonicalEmail, passwordHash, userApiKey, welcomeCredits, role, accountType);

      return res.status(201).json({
        status: "success",
        message: `E-mail vérifié et compte créé avec succès ! ${welcomeCredits} crédits offerts ${wasReferred ? '(Bonus Parrainage inclus !)' : ''} (Création ${regCount + 1}/${MAX_REGISTRATIONS_PER_GMAIL} pour cet e-mail).`,
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

  // 3. Connexion
  if (action === "login" || action === "signin") {
    if (security.isIpLockedOut(clientIp)) {
      return res.status(429).json({
        error: "Trop d'échecs de connexion consécutifs. Votre accès est temporairement bloqué pendant 15 minutes par sécurité."
      });
    }

    const rawEmail = (params.email || "").trim().toLowerCase();
    const canonicalEmail = security.canonicalizeEmail(rawEmail);
    const password = String(params.password || "").trim();

    if (!rawEmail || !password) {
      return res.status(400).json({ error: "E-mail et mot de passe requis." });
    }

    try {
      const user = await turso.getUserByEmail(canonicalEmail) || await turso.getUserByEmail(rawEmail);
      if (!user) {
        security.recordLoginAttempt(clientIp, false);
        return res.status(401).json({ error: "Identifiants incorrects." });
      }

      const passwordHash = security.hashPassword(password);
      if (user.password_hash !== passwordHash) {
        security.recordLoginAttempt(clientIp, false);
        return res.status(401).json({ error: "Mot de passe incorrect." });
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

  // 4. Quêtes & Récompenses WhatsApp
  if (action === "quests" || action === "quests_status" || action === "get_quests") {
    let authUser = null;
    let isAdm = false;
    let accountType = "studio";
    let claims = [];
    let refStats = { count: 0, total_earned: 0 };
    const today = new Date().toISOString().split("T")[0];

    const auth = await security.authenticateRequest(req);
    if (auth.authorized && auth.user) {
      authUser = auth.user;
      isAdm = auth.is_admin;
      accountType = auth.user.account_type || "studio";
      try {
        claims = await turso.getUserQuests(authUser.email);
        refStats = await turso.getReferralStats(authUser.email);
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
        }
      }
    }

    const processedQuests = QUESTS_LIST.map(q => {
      const reward = accountType === "developer" ? q.reward_dev : q.reward_studio;
      let claimed = false;
      let canClaim = true;
      let lastClaimedDate = null;

      if (authUser) {
        if (q.type === "one_time") {
          claimed = claims.some(c => c.quest_id === q.id);
          canClaim = !claimed;
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
        action_type: q.action_type,
        action_url: q.action_url,
        button_text: q.button_text,
        badge: q.badge,
        claimed,
        can_claim: canClaim,
        last_claimed_date: lastClaimedDate
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
        reward_per_invite: accountType === "developer" ? 15 : 30,
        invitee_welcome_bonus: 40
      },
      quests: processedQuests,
      summary: {
        total_quests_completed: totalClaimedCount,
        total_bonus_earned: totalBonusEarned
      }
    });
  }

  // 5. Validation / Réclamation d'une Quête
  if (action === "claim_quest" || action === "claimquest" || action === "claim") {
    const auth = await security.authenticateRequest(req);
    if (!auth.authorized || !auth.user) {
      return res.status(401).json({
        error: "Authentification requise : Veuillez vous connecter pour réclamer vos crédits de quête."
      });
    }

    const questId = String(params.quest_id || params.quest || "").trim().toLowerCase();
    const quest = QUESTS_LIST.find(q => q.id === questId);

    if (!quest) {
      return res.status(404).json({
        error: `Quête inconnue (${questId}). Quêtes disponibles : ${QUESTS_LIST.map(q => q.id).join(", ")}`
      });
    }

    const user = auth.user;
    const accountType = user.account_type || "studio";
    const reward = accountType === "developer" ? quest.reward_dev : quest.reward_studio;
    const today = new Date().toISOString().split("T")[0];

    try {
      if (quest.type === "one_time") {
        const already = await turso.hasClaimedQuest(user.email, quest.id);
        if (already) {
          return res.status(400).json({
            error: `Vous avez déjà validé la quête "${quest.title}". Merci pour votre participation !`
          });
        }
      } else if (quest.type === "daily") {
        const alreadyToday = await turso.hasClaimedQuest(user.email, quest.id, today);
        if (alreadyToday) {
          return res.status(400).json({
            error: `Vous avez déjà récupéré vos crédits pour la quête "${quest.title}" aujourd'hui. Revenez demain !`
          });
        }
      }

      const newCredits = await turso.claimQuest(user.email, quest.id, reward, today);

      return res.status(200).json({
        status: "success",
        message: `Félicitations ! Quête "${quest.title}" validée avec succès. +${reward} crédits ajoutés à votre solde !`,
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

  // 6. Suppression de compte
  if (action === "delete_account" || action === "delete" || action === "deleteaccount") {
    try {
      const auth = await security.authenticateRequest(req);
      if (!auth.authorized || !auth.user) {
        return res.status(401).json({ error: "Authentification requise pour supprimer votre compte." });
      }

      if (auth.is_admin && auth.key.startsWith("stanleystawa_live_")) {
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

  // 7. Profil & Crédits (Me)
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

  // 8. État du Cluster (Par défaut)
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
