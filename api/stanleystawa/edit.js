/**
 * api/stanleystawa/edit.js — Retouche et modification d'image
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
    const prompt = params.prompt || params.instructions;

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' est requis pour la retouche." });
    }

    const result = await engine.editImage({
      imageUrl: params.imageUrl || params.image_url,
      prompt,
      styleId: params.styleId || params.style_id || "5001"
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Edit Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
