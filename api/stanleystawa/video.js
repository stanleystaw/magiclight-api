/**
 * api/stanleystawa/video.js — Génération complète de vidéo multi-scènes (Images, Voix MagicLight, BGM)
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
    const prompt = params.prompt || params.text || params.idea;

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' ou 'text' est requis." });
    }

    const result = await engine.generateMultiSceneVideo({
      prompt,
      text: params.text || prompt,
      title: params.title || "Vidéo MagicLight",
      mode: params.mode || "expand",
      styleId: params.styleId || params.style_id || "5001",
      language: params.language || "french",
      ratio: params.ratio || 1
    });

    if (params.format === "mp4" && result.video_url) {
      return res.redirect(302, result.video_url);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
