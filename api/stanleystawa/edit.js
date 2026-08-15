/**
 * api/stanleystawa/edit.js — Retouche & Adaptation d'images via Cloudflare Workers AI (Tarif : 2 Crédits)
 *
 * POST /stanleystawa/edit { image, prompt, ratio }
 */

const engine = require("../../lib/magiclight");
const cloudflare = require("../../lib/cloudflare");
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
    const prompt = (params.prompt || params.instructions || "Amélioration des détails et mise en scène du personnage").trim();
    const image = params.image || params.imageUrl || params.image_url;
    const ratio = params.ratio || "16:9";

    if (!image) {
      return res.status(400).json({ error: "Le paramètre 'image' ou 'imageUrl' est requis." });
    }

    let remainingCredits = null;
    if (!auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 2);
    }

    // 1. Moteur Prioritaire : Cloudflare Workers AI Edit
    if (cloudflare.isConfigured()) {
      try {
        const cfResult = await cloudflare.editImage({ image, prompt, ratio });
        if (cfResult && (cfResult.image_url || cfResult.data_url)) {
          return res.status(200).json({
            ...cfResult,
            credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited"
          });
        }
      } catch (cfErr) {
        console.warn("[Cloudflare Edit Fallback]:", cfErr.message);
      }
    }

    // 2. Moteur Fallback : MagicLight / Flux HD Edit
    const result = await engine.editImage({
      image,
      prompt,
      ratio
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
