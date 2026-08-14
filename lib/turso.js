/**
 * lib/turso.js — Client Turso / libSQL HTTP v2 avec gestion des utilisateurs, des comptes et des crédits
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

  // --- GESTION DES UTILISATEURS (INSCRIPTION & AUTH) ---

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

  async createUser(email, passwordHash, apiKey, credits = 100, role = "user") {
    const sql = `
      INSERT INTO users (email, password_hash, api_key, credits, role)
      VALUES (?, ?, ?, ?, ?);
    `;
    await this.execute(sql, [email.trim(), passwordHash, apiKey.trim(), credits, role]);
    return {
      email: email.trim(),
      api_key: apiKey.trim(),
      credits,
      role
    };
  }

  async deductUserCredits(apiKey, amount = 5) {
    const user = await this.getUserByApiKey(apiKey);
    if (!user) return null;

    const currentCredits = parseInt(user.credits || 0, 10);
    const newCredits = Math.max(0, currentCredits - amount);

    await this.execute(`UPDATE users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE api_key = ?;`, [newCredits, apiKey]);
    return newCredits;
  }

  // --- GESTION DU CLUSTER DE COMPTES INTERNES MAGICLIGHT ---

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
        credits INTEGER DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await this.execute(sqlAccounts);
    await this.execute(sqlUsers);
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
