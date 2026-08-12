/**
 * api/stanleystawa/voice.js — Synthèse vocale IA officielle MagicLight TTS
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
    const text = params.text || params.prompt;

    if (!text) {
      return res.status(400).json({ error: "Le paramètre 'text' est requis." });
    }

    const result = await engine.synthesizeVoice({
      text,
      voiceId: params.voice_id || params.voiceId || "MM:lengdan_xiongzhang"
    });

    if (params.format === "audio" && result.audio_url) {
      return res.redirect(302, result.audio_url);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Voice Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
