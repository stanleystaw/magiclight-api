/**
 * lib/imagegen.js — Moteur de Génération Visuelle Hybride (Cloudflare Workers AI + Flux HD)
 */

const cloudflare = require("./cloudflare");

/**
 * Génère une image depuis un prompt.
 * 1. Cloudflare Workers AI Flux-1-Schnell (si configuré)
 * 2. Moteur Pollinations Flux HD (Résiliation instantanée)
 */
async function generateImage(prompt, { ratio = "1:1", format = "jpg", timeoutMs = 25000 } = {}) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) {
    throw new Error("Le prompt d'image est vide.");
  }

  const isPortrait = ratio === "9:16" || ratio === "2";
  const isLandscape = ratio === "16:9" || ratio === "1";
  const width = isPortrait ? 720 : (isLandscape ? 1280 : 1024);
  const height = isPortrait ? 1280 : (isLandscape ? 720 : 1024);

  // 1. Moteur A : Cloudflare Workers AI (Edge GPU)
  if (cloudflare.isConfigured()) {
    try {
      const cfBuf = await cloudflare.generateImage(cleanPrompt);
      if (cfBuf && cfBuf.length > 3000) {
        return {
          buffer: cfBuf,
          contentType: "image/jpeg",
          filename: "cf_generated.jpg",
          engine: "Cloudflare Workers AI (Flux-1-Schnell)"
        };
      }
    } catch (e) {
      console.warn("[Cloudflare AI Fallback]:", e.message);
    }
  }

  // 2. Moteur B : Flux HD Haute Fidélité
  const seed = Math.floor(Math.random() * 1000000);
  const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt + ", cinematic lighting, 8k masterpiece, detailed")}?width=${width}&height=${height}&nologo=true&seed=${seed}&model=flux`;

  const res = await fetch(fluxUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`Échec génération d'image (${res.status})`);
  }

  const arrBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrBuf);

  return {
    buffer: buf,
    contentType: "image/jpeg",
    filename: "flux_generated.jpg",
    engine: "Flux HD Vision"
  };
}

module.exports = { generateImage };
