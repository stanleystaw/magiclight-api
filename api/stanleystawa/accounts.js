/**
 * api/stanleystawa/accounts.js — Authentification, Inscription Sécurisée, Quêtes WhatsApp avec Vérification Réelle & Panel Admin
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
    description: "Rejoignez le groupe WhatsApp officiel et entrez le code secret situé dans la description du groupe.",
    reward_studio: 50,
    reward_dev: 20,
    type: "one_time",
    verification_type: "secret_code_and_phone",
    action_url: WHATSAPP_GROUP_URL,
    button_text: "Valider avec le Code Secret (+50)",
    badge: "Vérification Réelle"
  },
  {
    id: "share_whatsapp",
    title: "Partage Statut & Groupes WhatsApp",
    description: "Partagez l'invitation sur votre statut WhatsApp et renseignez votre numéro pour valider votre preuve.",
    reward_studio: 25,
    reward_dev: 10,
    type: "daily",
    verification_type: "phone_proof",
    button_text: "Partager & Valider (+25/j)",
    badge: "Quotidien (+25/j)"
  },
  {
    id: "share_video",
    title: "Défi Créateur ★ Stanley stawa",
    description: "Générez au moins une vidéo complète sur la plateforme pour valider automatiquement ce défi.",
    reward_studio: 20,
    reward_dev: 10,
    type: "daily",
    verification_type: "video_generation_check",
    button_text: "Vérifier ma Création (+20)",
    badge: "Preuve IA"
  },
  {
    id: "daily_checkin",
    title: "Bonus de Présence Journalière",
    description: "Connectez-vous chaque jour sur le studio pour récupérer vos crédits gratuits et maintenir votre streak.",
    reward_studio: 10,
    reward_dev: 5,
    type: "daily",
    verification_type: "instant",
    button_text: "Récupérer mon bonus (+10)",
    badge: "Tous les jours"
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
      return res.status(403).json({ error: "Accès refusé : Seul le compte administrateur officiel peut accéder à cette section." });
    }

    // 1. Statistiques globales
    if (action === "admin_stats") {
      try {
        const stats = await turso.getSystemStats();
        const secretCode = await turso.getSetting("whatsapp_secret_code", "STAWA-VIP-2026");
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
  }

  // ====================================================
  // ACTIONS UTILISATEUR (AUTHENTIFICATION & QUÊTES SÉCURISÉES)
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
        error: "Les adresses e-mails temporaires ou jetables sont strictement interdites. Utilisez une vraie adresse Gmail."
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
          welcomeCredits = 40;
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

  // 4. État des Quêtes & Récompenses
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

  // 5. VALIDATION SÉCURISÉE & VÉRIFICATION RÉELLE D'UNE QUÊTE
  if (action === "claim_quest" || action === "claimquest" || action === "claim") {
    const auth = await security.authenticateRequest(req);
    if (!auth.authorized || !auth.user) {
      return res.status(401).json({
        error: "Authentification requise : Veuillez vous connecter pour valider et réclamer vos quêtes."
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
        // Exiger le numéro WhatsApp
        const digitsPhone = submittedPhone.replace(/[^0-9]/g, "");
        if (!digitsPhone || digitsPhone.length < 8) {
          return res.status(400).json({
            error: "Numéro WhatsApp invalide. Veuillez renseigner votre vrai numéro WhatsApp (ex: +229 97 00 00 00) avec indicatif pays."
          });
        }

        // Vérifier l'unicité du numéro WhatsApp (1 seul compte par numéro WhatsApp)
        const phoneAlreadyUsed = await turso.hasWhatsAppNumberClaimed(digitsPhone, "join_whatsapp");
        if (phoneAlreadyUsed) {
          return res.status(403).json({
            error: `Sécurité anti-fraude : Le numéro WhatsApp ${submittedPhone} a déjà été utilisé pour valider cette quête.`
          });
        }

        // Exiger et vérifier le Code Secret du Groupe WhatsApp
        if (!submittedSecret) {
          return res.status(400).json({
            error: "Code Secret VIP manquant ! Veuillez rejoindre le groupe WhatsApp officiel et consulter la description ou le message épinglé pour trouver le code secret."
          });
        }

        const validSecret = await turso.getSetting("whatsapp_secret_code", "STAWA-VIP-2026");
        if (submittedSecret.toUpperCase().replace(/\s+/g, "") !== validSecret.toUpperCase().replace(/\s+/g, "")) {
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
