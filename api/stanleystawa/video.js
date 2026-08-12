/**
 * api/stanleystawa/video.js — Initialisation de vidéo 100% MagicLight AI Cloud (sans filigrane)
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

    const initResult = await engine.initVideoProject({
      prompt,
      text: params.text || prompt,
      title: params.title || "Vidéo MagicLight",
      mode: params.mode || "expand",
      styleId: params.styleId || params.style_id || "5001",
      language: params.language || "french",
      ratio: params.ratio || 1
    });

    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const checkUrl = `${protocol}://${host}/stanleystawa/status?project_id=${initResult.project_id}&account=${encodeURIComponent(initResult.account_email)}`;

    return res.status(200).json({
      status: "processing",
      project_id: initResult.project_id,
      account_email: initResult.account_email,
      check_url: checkUrl,
      message: "Projet vidéo initié sur MagicLight AI."
    });
  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
