/**
 * api/stanleystawa/edit.js — Retouche d'images via Creative Image Studio
 *
 * POST /stanleystawa/edit { image, prompt, ratio }
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
