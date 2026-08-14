/**
 * api/stanleystawa/edit.js — Retouche d'images IA (Tarif : 2 Crédits)
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
    return res.status(401).json({ error: "Accès refusé : Clé API ou inscription requise." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.instructions || "Amélioration des détails").trim();
    const image = params.image || params.imageUrl || params.image_url;

    if (!image) {
      return res.status(400).json({ error: "Le paramètre 'image' ou 'imageUrl' est requis." });
    }

    let remainingCredits = null;
    if (!auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 2);
    }

    const result = await engine.editImage({
      image,
      prompt,
      ratio: params.ratio || "16:9"
    });

    return res.status(200).json({
      ...result,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited"
    });
  } catch (err) {
    console.error("[API Edit Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
