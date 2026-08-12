/**
 * api/stanleystawa/video.js — Initialisation ultra-rapide de vidéo MagicLight (compatible Vercel Serverless)
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

    // Initialisation instantanée du projet sur MagicLight (< 1s)
    const initResult = await engine.initVideoProject({
      prompt,
      text: params.text || prompt,
      title: params.title || "Vidéo MagicLight",
      mode: params.mode || "expand",
      styleId: params.styleId || params.style_id || "5001",
      language: params.language || "french",
      ratio: params.ratio || 1
    });

    const host = req.headers.host || "vercel-animate-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const checkUrl = `${protocol}://${host}/stanleystawa/status?project_id=${initResult.project_id}&account=${encodeURIComponent(initResult.account_email)}`;

    return res.status(200).json({
      status: "processing",
      project_id: initResult.project_id,
      account_email: initResult.account_email,
      check_url: checkUrl,
      message: "Projet vidéo initié avec succès sur MagicLight AI. Interrogez 'check_url' pour suivre l'avancement et récupérer la vidéo finale."
    });
  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
