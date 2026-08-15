/**
 * api/stanleystawa/image.js — Génération d'images HD via Cloudflare Workers AI (Flux-1-Schnell) & Fallback
 *
 * GET/POST /stanleystawa/image?prompt=...&ratio=16:9&format=image
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");
const cloudflare = require("../../lib/cloudflare");

async function fetchImageBuffer(prompt, ratio = "16:9") {
  const isPortrait = ratio === "9:16" || ratio === "2";
  const isSquare = ratio === "1:1";
  const width = isPortrait ? 720 : (isSquare ? 1024 : 1280);
  const height = isPortrait ? 1280 : (isSquare ? 1024 : 720);
  const cleanPrompt = String(prompt || "").trim();

  // 1. Moteur Prioritaire : Cloudflare Workers AI (Flux-1-Schnell)
  if (cloudflare.isConfigured()) {
    try {
      const cfBuf = await cloudflare.generateImage(cleanPrompt, { num_steps: 4, width, height });
      if (cfBuf && cfBuf.length > 3000) {
        return { buffer: cfBuf, contentType: "image/jpeg", engine: "Cloudflare Workers AI (Flux-1-Schnell)" };
      }
    } catch (e) {
      console.warn("[Cloudflare Image AI Warning]:", e.message);
    }
  }

  // 2. Moteur Fallback : Flux HD Haute Définition
  const seed = Math.floor(Math.random() * 999999);
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt + ", cinematic lighting, 8k masterpiece, detailed")}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok && res.headers.get("content-type")?.includes("image")) {
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (buf.length > 3000) {
        return { buffer: buf, contentType: "image/jpeg", engine: "Flux HD Vision" };
      }
    }
  } catch (err) {
    console.warn("[Image Fallback Warning]:", err.message);
  }

  return null;
}

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

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

    // Déduction de 1 crédit si utilisateur authentifié
    const auth = await security.authenticateRequest(req);
    let remainingCredits = null;
    if (auth.authorized && !auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 1);
    }

    const host = req.headers.host || "magiclight-api-gamma.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const publicImageUrl = `${protocol}://${host}/stanleystawa/image?prompt=${encodeURIComponent(prompt)}&ratio=${ratioStr}&format=image`;

    if (format === "image" || format === "jpg" || format === "png") {
      const imgData = await fetchImageBuffer(prompt, ratioStr);
      if (imgData && imgData.buffer) {
        res.setHeader("Content-Type", imgData.contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.status(200).send(imgData.buffer);
      } else {
        return res.redirect(302, `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true`);
      }
    }

    const engineName = cloudflare.isConfigured() ? "Cloudflare Workers AI (Flux-1-Schnell)" : "Stanley Stawa Neural Vision HD";

    return res.status(200).json({
      status: "success",
      image_url: publicImageUrl,
      prompt,
      ratio: ratioStr,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
      engine: engineName
    });
  } catch (err) {
    console.error("[API Image Error]", err);
    return res.status(500).json({ error: "Erreur lors de la génération de l'image." });
  }
};
