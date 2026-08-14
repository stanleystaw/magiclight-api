/**
 * api/stanleystawa/voice.js — Synthèse vocale IA (Tarif : 1 Crédit)
 */

const engine = require("../../lib/magiclight");
const turso = require("../../lib/turso");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const text = (params.text || params.prompt || "").trim();
    const voiceId = params.voice_id || params.voiceId || "MM:lengdan_xiongzhang";
    const format = String(params.format || "json").toLowerCase();

    if (!text) {
      return res.status(400).json({ error: "Le paramètre 'text' est requis." });
    }

    const auth = await security.authenticateRequest(req);
    let remainingCredits = null;
    if (auth.authorized && !auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 1);
    }

    const result = await engine.synthesizeVoice({
      text,
      voiceId
    });

    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const publicAudioUrl = `${protocol}://${host}/stanleystawa/voice?text=${encodeURIComponent(text)}&voice_id=${encodeURIComponent(voiceId)}&format=audio`;

    if (format === "audio" || format === "mp3") {
      const audioFetch = await fetch(result.direct_upstream_audio);
      if (!audioFetch.ok) {
        return res.status(502).json({ error: "Impossible de récupérer le flux audio." });
      }
      const arrayBuffer = await audioFetch.arrayBuffer();
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", 'inline; filename="voice.mp3"');
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.status(200).send(Buffer.from(arrayBuffer));
    }

    return res.status(200).json({
      status: "success",
      text,
      voice_id: voiceId,
      audio_url: publicAudioUrl,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
      engine: "Stanley Stawa Neural Voice HD"
    });
  } catch (err) {
    console.error("[API Voice Error]", err);
    return res.status(500).json({ error: "Erreur lors de la synthèse vocale." });
  }
};
