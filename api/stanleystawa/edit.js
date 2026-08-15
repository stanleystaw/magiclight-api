/**
 * api/stanleystawa/edit.js — Retouche & Transformation d'Image (Gemini 3.1 Flash-Lite Image & Cloudflare)
 * Tarif : 2 Crédits
 */

const engine = require("../../lib/magiclight");
const gemini = require("../../lib/gemini");
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
      return res.status(400).json({ error: "Le paramètre 'image' ou 'imageUrl' est requis pour la retouche." });
    }

    let remainingCredits = null;
    if (!auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 2);
    }

    // 1. Moteur Prioritaire : Gemini 3.1 Flash-Lite Image (Google AI Studio)
    if (gemini.isConfigured()) {
      try {
        const geminiBuf = await gemini.generateOrEditImage(prompt, { inputImageBase64: image, aspectRatio: ratio });
        if (geminiBuf && geminiBuf.length > 2000) {
          const b64 = geminiBuf.toString("base64");
          const dataUrl = `data:image/jpeg;base64,${b64}`;
          return res.status(200).json({
            status: "success",
            image_url: dataUrl,
            data_url: dataUrl,
            prompt,
            ratio,
            credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
            engine: "Google AI Studio (Gemini 3.1 Flash-Lite Image)"
          });
        }
      } catch (gErr) {
        console.warn("[Gemini Edit Warning]:", gErr.message);
      }
    }

    // 2. Moteur Fallback : Cloudflare & Diffusion Engine
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
