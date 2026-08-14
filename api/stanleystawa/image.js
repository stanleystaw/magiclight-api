/**
 * api/stanleystawa/image.js — Génération d'images HD avec Proxy Direct Sécurisé
 *
 * GET/POST /stanleystawa/image?prompt=...&ratio=16:9&format=image
 */

const engine = require("../../lib/magiclight");
const CREATIVE_STUDIO_API = "https://creative-image-studio.onrender.com";

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.text || "").trim();
    const ratio = params.ratio || "16:9";
    const ratioStr = ratio === "2" || ratio === 2 || ratio === "9:16" ? "9:16" : "16:9";
    const format = String(params.format || "json").toLowerCase();

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' est requis." });
    }

    if (format === "image" || format === "jpg" || format === "png") {
      const upstreamRes = await fetch(`${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(prompt)}&ratio=${ratioStr}`);
      if (!upstreamRes.ok) {
        return res.status(upstreamRes.status).json({ error: "Erreur génération d'image" });
      }
      const arrayBuffer = await upstreamRes.arrayBuffer();
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.status(200).send(Buffer.from(arrayBuffer));
    }

    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const publicImageUrl = `${protocol}://${host}/stanleystawa/image?prompt=${encodeURIComponent(prompt)}&ratio=${ratioStr}&format=image`;

    return res.status(200).json({
      status: "success",
      image_url: publicImageUrl,
      prompt,
      ratio: ratioStr,
      engine: "MagicLight Studio AI Vision"
    });
  } catch (err) {
    console.error("[API Image Error]", err);
    return res.status(500).json({ error: "Erreur lors du traitement de l'image." });
  }
};
