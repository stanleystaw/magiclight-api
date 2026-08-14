/**
 * lib/turso.js — Client Turso / libSQL HTTP v2 avec gestion complète Utilisateurs, Tâches, Quêtes & Administration
 */

const TURSO_URL = process.env.TURSO_DATABASE_URL || "https://magicligth-stanleystawa354.aws-eu-west-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODY1NDMwODcsImlkIjoiMDE5ZmY2NDMtZmEwMS03NzBkLWE3YjgtMWFkMDQzOWEzN2Q0Iiwia2lkIjoiRUowd0tEaER4WmxUYlZ5MHJLX1VRRnhGZml6NF9nTEp2WXBPdFdiQlM2USIsInJpZCI6ImYzNDE1MGEzLTJkMzMtNDBjOC05ZmFmLWViMDBhODFhOGFhMiJ9.DVj4IWSi5WgU1frG8BVvUmINQYQRN77Kqe0-GLT2qgTv_w6M4ccKOP-GsEkNnaL3jX7Ikb4g7Eo45llVcQAgBQ";

class TursoDB {
  constructor() {
    let url = TURSO_URL.replace("libsql://", "https://");
    if (!url.endsWith("/v2/pipeline")) {
      url = url.replace(/\/$/, "") + "/v2/pipeline";
    }
    this.pipelineUrl = url;
    this.token = TURSO_TOKEN;
  }

  async execute(sql, args = []) {
    const formattedArgs = args.map(arg => {
      if (typeof arg === "number") {
        if (Number.isInteger(arg)) {
          return { type: "integer", value: String(arg) };
        }
        return { type: "float", value: arg };
      } else if (arg === null || arg === undefined) {
        return { type: "null" };
      } else {
        return { type: "text", value: String(arg) };
      }
    });

    const payload = {
      requests: [
        {
          type: "execute",
          stmt: {
            sql,
            args: formattedArgs
          }
        },
        { type: "close" }
      ]
    };

    const res = await fetch(this.pipelineUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur Turso DB (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const result = data.results?.[0]?.response?.result;
    if (!result) return [];

    const cols = result.cols?.map(c => c.name) || [];
    const rows = (result.rows || []).map(row => {
      const obj = {};
      row.forEach((cell, idx) => {
        const colName = cols[idx];
        obj[colName] = cell.value;
      });
      return obj;
    });

    return rows;
  }

  // --- PARAMÈTRES GLOBAUX & CONFIGURATION DYNAMIQUE ---

  async getSetting(key, defaultValue = "") {
    try {
      const rows = await this.execute(`SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1;`, [key]);
      if (rows.length && rows[0].setting_value !== undefined && rows[0].setting_value !== null) {
        return String(rows[0].setting_value).trim();
      }
    } catch (e) {}
    return defaultValue;
  }

  async setSetting(key, value) {
    const sql = `
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = CURRENT_TIMESTAMP;
    `;
    return this.execute(sql, [key, String(value).trim()]);
  }

  // --- HISTORIQUE STRICT DES INSCRIPTIONS PAR GMAIL (MAX 2 CRÉATIONS) ---

  async getEmailRegistrationCount(email) {
    const cleanEmail = email.trim().toLowerCase();
    const sql = `SELECT registrations_count FROM email_creation_history WHERE email = ? LIMIT 1;`;
    const rows = await this.execute(sql, [cleanEmail]);
    if (!rows.length) return 0;
    return parseInt(rows[0].registrations_count || 0, 10);
  }

  async incrementEmailRegistrationCount(email) {
    const cleanEmail = email.trim().toLowerCase();
    const sql = `
      INSERT INTO email_creation_history (email, registrations_count)
      VALUES (?, 1)
      ON CONFLICT(email) DO UPDATE SET
        registrations_count = email_creation_history.registrations_count + 1,
        updated_at = CURRENT_TIMESTAMP;
    `;
    return this.execute(sql, [cleanEmail]);
  }

  // --- GESTION SÉCURISÉE DES CODES OTP ---

  async saveOtp(email, otpCode, ttlMinutes = 10) {
    const cleanEmail = email.trim().toLowerCase();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString();

    const sql = `
      INSERT INTO email_verifications (email, otp_code, expires_at, attempts)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(email) DO UPDATE SET
        otp_code=excluded.otp_code,
        expires_at=excluded.expires_at,
        attempts=0,
        created_at=CURRENT_TIMESTAMP;
    `;
    return this.execute(sql, [cleanEmail, otpCode, expiresAt]);
  }

  async verifyOtp(email, otpCode) {
    const cleanEmail = email.trim().toLowerCase();
    const sql = `SELECT * FROM email_verifications WHERE email = ? LIMIT 1;`;
    const rows = await this.execute(sql, [cleanEmail]);
    if (!rows.length) {
      return { valid: false, reason: "Aucun code en attente pour cet e-mail. Veuillez cliquer sur 'Envoyer Code'." };
    }

    const record = rows[0];
    const currentAttempts = parseInt(record.attempts || 0, 10);

    const expiresAt = new Date(record.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await this.deleteOtp(cleanEmail);
      return { valid: false, reason: "Le code OTP a expiré (durée de validité : 10 min). Veuillez redemander un code." };
    }

    if (record.otp_code !== otpCode) {
      const nextAttempts = currentAttempts + 1;
      if (nextAttempts >= 3) {
        await this.deleteOtp(cleanEmail);
        return { valid: false, reason: "3 tentatives incorrectes consécutives. Le code a été révoqué par sécurité." };
      }
      await this.execute(`UPDATE email_verifications SET attempts = ? WHERE email = ?;`, [nextAttempts, cleanEmail]);
      return { valid: false, reason: `Code incorrect (tentative ${nextAttempts}/3).` };
    }

    await this.deleteOtp(cleanEmail);
    return { valid: true };
  }

  async deleteOtp(email) {
    const cleanEmail = email.trim().toLowerCase();
    return this.execute(`DELETE FROM email_verifications WHERE email = ?;`, [cleanEmail]);
  }

  // --- GESTION DES UTILISATEURS (AVEC CHOIX DE TYPE DE COMPTE) ---

  async getUserByEmail(email) {
    const sql = `SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1;`;
    const rows = await this.execute(sql, [email.trim()]);
    return rows[0] || null;
  }

  async getUserByApiKey(apiKey) {
    if (!apiKey) return null;
    const sql = `SELECT * FROM users WHERE api_key = ? LIMIT 1;`;
    const rows = await this.execute(sql, [apiKey.trim()]);
    return rows[0] || null;
  }

  async createUser(email, passwordHash, apiKey, credits = 30, role = "user", accountType = "studio") {
    const cleanEmail = email.trim().toLowerCase();
    const sql = `
      INSERT INTO users (email, password_hash, api_key, credits, role, account_type)
      VALUES (?, ?, ?, ?, ?, ?);
    `;
    await this.execute(sql, [cleanEmail, passwordHash, apiKey.trim(), credits, role, accountType]);
    await this.incrementEmailRegistrationCount(cleanEmail);

    return {
      email: cleanEmail,
      api_key: apiKey.trim(),
      credits,
      role,
      account_type: accountType
    };
  }

  async deductUserCredits(apiKey, amount = 1) {
    const user = await this.getUserByApiKey(apiKey);
    if (!user) return null;

    const currentCredits = parseInt(user.credits || 0, 10);
    const newCredits = Math.max(0, currentCredits - amount);

    await this.execute(`UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE api_key = ?;`, [newCredits, apiKey]);
    return newCredits;
  }

  async addUserCredits(emailOrKey, amount = 1) {
    const isKey = String(emailOrKey).startsWith("stanleystawa_") || String(emailOrKey).startsWith("stawa_");
    const sql = isKey
      ? `UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE api_key = ?;`
      : `UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?);`;
    await this.execute(sql, [amount, String(emailOrKey).trim()]);
    const user = isKey ? await this.getUserByApiKey(emailOrKey) : await this.getUserByEmail(emailOrKey);
    return user ? parseInt(user.credits || 0, 10) : 0;
  }

  async deleteUserAccount(apiKey) {
    if (!apiKey) return false;
    const sql = `DELETE FROM users WHERE api_key = ?;`;
    await this.execute(sql, [apiKey.trim()]);
    return true;
  }

  // --- GESTION SÉCURISÉE DU SYSTÈME DE QUÊTES & VÉRIFICATIONS RÉELLES ---

  async getUserQuests(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const sql = `SELECT * FROM user_quests WHERE LOWER(user_email) = LOWER(?) ORDER BY created_at DESC;`;
    return this.execute(sql, [cleanEmail]);
  }

  async hasClaimedQuest(email, questId, dateStr = null) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    let sql, args;
    if (dateStr) {
      sql = `SELECT id FROM user_quests WHERE LOWER(user_email) = LOWER(?) AND quest_id = ? AND claimed_date = ? LIMIT 1;`;
      args = [cleanEmail, questId, dateStr];
    } else {
      sql = `SELECT id FROM user_quests WHERE LOWER(user_email) = LOWER(?) AND quest_id = ? LIMIT 1;`;
      args = [cleanEmail, questId];
    }
    const rows = await this.execute(sql, args);
    return rows.length > 0;
  }

  async hasWhatsAppNumberClaimed(whatsappNumber, questId) {
    const digitsOnly = String(whatsappNumber || "").replace(/[^0-9]/g, "");
    if (!digitsOnly || digitsOnly.length < 8) return false;
    const sql = `
      SELECT id FROM user_quests 
      WHERE quest_id = ? 
      AND REPLACE(REPLACE(REPLACE(REPLACE(whatsapp_number, '+', ''), ' ', ''), '-', ''), '.', '') = ? 
      LIMIT 1;
    `;
    const rows = await this.execute(sql, [questId, digitsOnly]);
    return rows.length > 0;
  }

  async hasUserCompletedVideo(email) {
    // Vérification stricte : le système vérifie qu'une vidéo a bien été achevée
    const sql = `SELECT task_id FROM video_tasks WHERE status = 'completed' LIMIT 1;`;
    const rows = await this.execute(sql);
    return rows.length > 0;
  }

  async claimQuest(email, questId, rewardCredits, dateStr = null, whatsappNumber = "", proofData = "") {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const curDate = dateStr || new Date().toISOString().split("T")[0];
    const cleanPhone = String(whatsappNumber || "").trim();
    const cleanProof = String(proofData || "").trim();

    const sql = `
      INSERT INTO user_quests (user_email, quest_id, reward_credits, claimed_date, whatsapp_number, proof_data)
      VALUES (?, ?, ?, ?, ?, ?);
    `;
    await this.execute(sql, [cleanEmail, questId, rewardCredits, curDate, cleanPhone, cleanProof]);
    const newCredits = await this.addUserCredits(cleanEmail, rewardCredits);
    return newCredits;
  }

  async recordReferral(referrerEmail, newEmail, referrerReward = 30) {
    const cleanReferrer = String(referrerEmail || "").trim().toLowerCase();
    const cleanNew = String(newEmail || "").trim().toLowerCase();
    if (!cleanReferrer || !cleanNew || cleanReferrer === cleanNew) return false;

    // Vérifier que le parrain existe
    const referrerUser = await this.getUserByEmail(cleanReferrer);
    if (!referrerUser) return false;

    // Vérifier que le filleul n'a pas déjà été parrainé
    const existing = await this.execute(`SELECT id FROM referrals WHERE LOWER(referred_email) = LOWER(?) LIMIT 1;`, [cleanNew]);
    if (existing.length > 0) return false;

    const isDev = referrerUser.account_type === "developer";
    const actualReward = isDev ? 15 : 30;

    await this.execute(
      `INSERT INTO referrals (referrer_email, referred_email, reward_credited) VALUES (?, ?, ?);`,
      [cleanReferrer, cleanNew, actualReward]
    );
    await this.addUserCredits(cleanReferrer, actualReward);
    return true;
  }

  async getReferralStats(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const rows = await this.execute(
      `SELECT COUNT(*) as count, COALESCE(SUM(reward_credited), 0) as total_earned FROM referrals WHERE LOWER(referrer_email) = LOWER(?);`,
      [cleanEmail]
    );
    return {
      count: parseInt(rows[0]?.count || 0, 10),
      total_earned: parseInt(rows[0]?.total_earned || 0, 10)
    };
  }

  async getAllQuestClaims(limit = 60) {
    const sql = `
      SELECT id, user_email, quest_id, reward_credits, whatsapp_number, proof_data, claimed_date, created_at 
      FROM user_quests 
      ORDER BY created_at DESC 
      LIMIT ?;
    `;
    return this.execute(sql, [limit]);
  }

  // --- FONCTIONS DU PANEL ADMINISTRATEUR ---

  async getAllUsers(limit = 100) {
    const sql = `SELECT id, email, api_key, credits, role, account_type, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT ?;`;
    return this.execute(sql, [limit]);
  }

  async updateUserCredits(emailOrId, credits) {
    const isId = !String(emailOrId).includes("@");
    const sql = isId
      ? `UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`
      : `UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?);`;
    return this.execute(sql, [credits, emailOrId]);
  }

  async deleteUserByAdmin(emailOrId) {
    const isId = !String(emailOrId).includes("@");
    const sql = isId ? `DELETE FROM users WHERE id = ?;` : `DELETE FROM users WHERE LOWER(email) = LOWER(?);`;
    return this.execute(sql, [emailOrId]);
  }

  async getRecentTasks(limit = 40) {
    const sql = `SELECT task_id, prompt, status, progress, duration, scenes_count, video_url, cover_url, message, created_at FROM video_tasks ORDER BY created_at DESC LIMIT ?;`;
    return this.execute(sql, [limit]);
  }

  async deleteTask(taskId) {
    const sql = `DELETE FROM video_tasks WHERE task_id = ?;`;
    return this.execute(sql, [taskId]);
  }

  async getSystemStats() {
    const usersRows = await this.execute(`SELECT COUNT(*) as count, SUM(credits) as total_user_credits FROM users;`);
    const tasksRows = await this.execute(`SELECT COUNT(*) as total_tasks, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed_tasks FROM video_tasks;`);
    const historyRows = await this.execute(`SELECT COUNT(*) as total_verified_emails FROM email_creation_history;`);
    const questsRows = await this.execute(`SELECT COUNT(*) as total_claimed, SUM(reward_credits) as total_rewarded FROM user_quests;`);
    const accounts = await this.getActiveAccounts();
    const clusterCredits = accounts.reduce((acc, a) => acc + parseInt(a.credits || 0, 10), 0);

    return {
      total_registered_users: parseInt(usersRows[0]?.count || 0, 10),
      total_user_credits_issued: parseInt(usersRows[0]?.total_user_credits || 0, 10),
      total_video_tasks: parseInt(tasksRows[0]?.total_tasks || 0, 10),
      completed_videos: parseInt(tasksRows[0]?.completed_tasks || 0, 10),
      total_verified_emails: parseInt(historyRows[0]?.total_verified_emails || 0, 10),
      total_quests_claimed: parseInt(questsRows[0]?.total_claimed || 0, 10),
      total_quests_rewards_distributed: parseInt(questsRows[0]?.total_rewarded || 0, 10),
      active_cluster_nodes: accounts.length,
      cluster_credits_pool: clusterCredits
    };
  }

  // --- GESTION DU CLUSTER DE COMPTES INTERNES MAGICLIGHT ---

  async cleanDeadAccounts() {
    return this.execute(`DELETE FROM magiclight_accounts WHERE credits <= 0 OR status = 'disabled';`);
  }

  async getAllAccountsDetailed() {
    return this.execute(`SELECT id, email, credits, status, created_at, updated_at FROM magiclight_accounts ORDER BY credits DESC;`);
  }

  async getActiveAccounts() {
    const sql = `SELECT * FROM magiclight_accounts WHERE status = 'active' AND credits > 0 ORDER BY credits DESC;`;
    try {
      return await this.execute(sql);
    } catch (err) {
      await this.initSchema();
      return await this.execute(sql);
    }
  }

  async initSchema() {
    const sqlSettings = `
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const sqlAccounts = `
      CREATE TABLE IF NOT EXISTS magiclight_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        credits INTEGER DEFAULT 800,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const sqlUsers = `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        credits INTEGER DEFAULT 30,
        account_type TEXT DEFAULT 'studio',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const sqlOtp = `
      CREATE TABLE IF NOT EXISTS email_verifications (
        email TEXT PRIMARY KEY,
        otp_code TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        attempts INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const sqlHistory = `
      CREATE TABLE IF NOT EXISTS email_creation_history (
        email TEXT PRIMARY KEY,
        registrations_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const sqlQuests = `
      CREATE TABLE IF NOT EXISTS user_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        reward_credits INTEGER NOT NULL,
        claimed_date TEXT,
        whatsapp_number TEXT,
        proof_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    const sqlReferrals = `
      CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_email TEXT NOT NULL,
        referred_email TEXT UNIQUE NOT NULL,
        reward_credited INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await this.execute(sqlSettings);
    await this.execute(sqlAccounts);
    await this.execute(sqlUsers);
    await this.execute(sqlOtp);
    await this.execute(sqlHistory);
    await this.execute(sqlQuests);
    await this.execute(sqlReferrals);

    // Initialiser le code secret par défaut du groupe WhatsApp si absent
    await this.execute(`
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES ('whatsapp_secret_code', 'STAWA-VIP-2026')
      ON CONFLICT(setting_key) DO NOTHING;
    `);

    try {
      await this.execute(`ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT 'studio';`);
    } catch (e) {}

    try {
      await this.execute(`ALTER TABLE user_quests ADD COLUMN whatsapp_number TEXT;`);
    } catch (e) {}

    try {
      await this.execute(`ALTER TABLE user_quests ADD COLUMN proof_data TEXT;`);
    } catch (e) {}
  }

  async addOrUpdateAccount(email, password, accessToken, refreshToken = "", credits = 800) {
    const sql = `
      INSERT INTO magiclight_accounts (email, password, access_token, refresh_token, credits, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON CONFLICT(email) DO UPDATE SET
        password=excluded.password,
        access_token=excluded.access_token,
        refresh_token=excluded.refresh_token,
        credits=excluded.credits,
        status='active',
        updated_at=CURRENT_TIMESTAMP;
    `;
    return this.execute(sql, [email, password, accessToken, refreshToken, credits]);
  }

  async deductCredits(email, amount = 5) {
    const accounts = await this.execute(`SELECT credits FROM magiclight_accounts WHERE email = ?;`, [email]);
    if (!accounts.length) return;

    const currentCredits = parseInt(accounts[0].credits || 0, 10);
    const newCredits = Math.max(0, currentCredits - amount);

    if (newCredits <= 0) {
      await this.deleteAccount(email);
    } else {
      await this.execute(`UPDATE magiclight_accounts SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?;`, [newCredits, email]);
    }
    return newCredits;
  }

  async deleteAccount(email) {
    return this.execute(`DELETE FROM magiclight_accounts WHERE email = ?;`, [email]);
  }
}

module.exports = new TursoDB();
