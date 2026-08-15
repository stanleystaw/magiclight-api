/**
 * api/stanleystawa/edit.js — Retouche & Adaptation de Personnage 100% Identique
 * Tarif : 2 Crédits
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
    const prompt = (params.prompt || params.instructions || "Mise en scène du personnage dans un nouveau décor").trim();
    const image = params.image || params.imageUrl || params.image_url;
    const ratio = params.ratio || "16:9";

    if (!image) {
      return res.status(400).json({ error: "Le paramètre 'image' ou 'imageUrl' est requis pour la retouche." });
    }

    let remainingCredits = null;
    if (!auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 2);
    }

    // Exécution du Moteur Neural Image-to-Image Diffusion
    const result = await engine.editImage({
      image,
      prompt,
      ratio,
      strength: params.strength || 0.60
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
