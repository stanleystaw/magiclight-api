/**
 * api/stanleystawa/auth/register.js — Inscription d'un nouvel utilisateur (+100 Crédits offerts)
 *
 * POST /stanleystawa/auth/register { email, password }
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

  // Anti-DDoS rate limiting sur l'inscription
  if (!security.checkRateLimit(req, 10)) {
    return res.status(429).json({ error: "Trop de tentatives. Veuillez patienter une minute." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const email = (params.email || "").trim().toLowerCase();
    const password = String(params.password || "").trim();

    if (!email || !email.includes("@") || !email.includes(".")) {
      return res.status(400).json({ error: "Adresse e-mail valide requise." });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
    }

    // Vérifier si l'utilisateur existe déjà
    const existing = await turso.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Un compte existe déjà avec cette adresse e-mail. Veuillez vous connecter." });
    }

    // Création de l'utilisateur
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
};
