/**
 * api/stanleystawa/edit.js — Retouche d'images sécurisée avec clé API
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
    const prompt = (params.prompt || params.instructions || "Amélioration des détails").trim();
    const image = params.image || params.imageUrl || params.image_url;

    if (!image) {
      return res.status(400).json({ error: "Le paramètre 'image' ou 'imageUrl' est requis." });
    }

    const result = await engine.editImage({
      image,
      prompt,
      ratio: params.ratio || "16:9"
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Edit Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
