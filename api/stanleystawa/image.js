/**
 * api/stanleystawa/image.js — Génération d'images HD avec Moteur Résilient Multi-Sources
 *
 * GET/POST /stanleystawa/image?prompt=...&ratio=16:9&format=image
 */

const security = require("../../lib/security");

async function fetchImageBuffer(prompt, ratio = "16:9") {
  const isPortrait = ratio === "9:16" || ratio === "2";
  const isSquare = ratio === "1:1";
  const width = isPortrait ? 576 : (isSquare ? 768 : 1024);
  const height = isPortrait ? 1024 : (isSquare ? 768 : 576);
  const seed = Math.floor(Math.random() * 999999);

  const cleanPrompt = String(prompt || "").trim();

  // Source 1 : Pollinations AI avec en-têtes réalistes
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&nofeed=true`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (res.ok && res.headers.get("content-type")?.includes("image")) {
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (buf.length > 5000) {
        return { buffer: buf, contentType: "image/jpeg" };
      }
    }
  } catch (err) {
    console.warn("[Image Source 1 Warning]", err.message);
  }

  // Source 2 : Source de secours HD
  try {
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt + ", cinematic lighting, 8k masterpiece")}?seed=${seed}&nologo=true`;
    const res = await fetch(fallbackUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok && res.headers.get("content-type")?.includes("image")) {
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      if (buf.length > 5000) {
        return { buffer: buf, contentType: "image/jpeg" };
      }
    }
  } catch (e) {
    console.warn("[Image Source 2 Warning]", e.message);
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

    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const publicImageUrl = `${protocol}://${host}/stanleystawa/image?prompt=${encodeURIComponent(prompt)}&ratio=${ratioStr}&format=image`;

    if (format === "image" || format === "jpg" || format === "png") {
      const imgData = await fetchImageBuffer(prompt, ratioStr);
      if (imgData && imgData.buffer) {
        res.setHeader("Content-Type", imgData.contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.status(200).send(imgData.buffer);
      } else {
        // Redirection vers le flux direct
        return res.redirect(302, `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true`);
      }
    }

    return res.status(200).json({
      status: "success",
      image_url: publicImageUrl,
      prompt,
      ratio: ratioStr,
      engine: "Stanley Stawa Neural Vision HD"
    });
  } catch (err) {
    console.error("[API Image Error]", err);
    return res.status(500).json({ error: "Erreur lors de la génération de l'image." });
  }
};
