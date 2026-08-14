/**
 * api/stanleystawa/story.js — Expansion de scénario sécurisée avec clé API
 */

const engine = require("../../lib/magiclight");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!security.isAuthorized(req)) {
    return res.status(401).json({
      error: "Accès refusé : Clé API secrète invalide ou manquante."
    });
  }

  if (!security.checkRateLimit(req, 20)) {
    return res.status(429).json({ error: "Trop de requêtes. Veuillez patienter une minute." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const idea = params.idea || params.prompt || params.text;

    if (!idea) {
      return res.status(400).json({ error: "Le paramètre 'idea' ou 'prompt' est requis." });
    }

    const result = await engine.expandStory(
      idea,
      params.language || "french",
      params.styleId || params.style_id || "5001"
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Story Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
