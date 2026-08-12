/**
 * api/stanleystawa/image.js — Génération d'images HD
 */

const engine = require("../../lib/magiclight");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = params.prompt || params.text;

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' est requis." });
    }

    const result = await engine.generateImage({
      prompt,
      styleId: params.styleId || params.style_id || "5001",
      ratio: params.ratio || 1
    });

    if (params.format === "image" && result.image_url) {
      return res.redirect(302, result.image_url);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Image Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
