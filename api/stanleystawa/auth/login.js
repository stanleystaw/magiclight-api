/**
 * api/stanleystawa/auth/login.js — Connexion utilisateur & récupération de la clé API
 *
 * POST /stanleystawa/auth/login { email, password }
 */

const turso = require("../../../lib/turso");
const security = require("../../../lib/security");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!security.checkRateLimit(req, 15)) {
    return res.status(429).json({ error: "Trop de tentatives de connexion. Veuillez patienter." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const email = (params.email || "").trim().toLowerCase();
    const password = String(params.password || "").trim();

    if (!email || !password) {
      return res.status(400).json({ error: "E-mail et mot de passe requis." });
    }

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
};
