/**
 * api/stanleystawa/story.js — Découpage & Scénarisation IA (Tarif : 1 Crédit)
 */

const engine = require("../../lib/magiclight");
const turso = require("../../lib/turso");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const auth = await security.authenticateRequest(req);
  if (!auth.authorized) {
    return res.status(401).json({ error: "Accès refusé : Inscription ou clé requise." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const idea = params.idea || params.prompt || params.text;

    if (!idea) {
      return res.status(400).json({ error: "Le paramètre 'idea' ou 'prompt' est requis." });
    }

    let remainingCredits = null;
    if (!auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 1);
    }

    const result = await engine.expandStory(
      idea,
      params.language || "french",
      params.styleId || params.style_id || "5001"
    );

    return res.status(200).json({
      ...result,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited"
    });
  } catch (err) {
    console.error("[API Story Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
