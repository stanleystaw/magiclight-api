/**
 * lib/imagegen.js — Génération d'images (API de la commande "draw").
 * URL configurable via IMAGE_GEN_URL (défaut : https://gem-tw6a.onrender.com).
 */
const axios = require("axios");

const IMAGE_GEN_URL = process.env.IMAGE_GEN_URL || "https://gem-tw6a.onrender.com";

/**
 * Génère une image depuis un prompt.
 * @param {string} prompt
 * @param {{ratio?: string, format?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{buffer: Buffer, contentType: string, filename: string}>}
 * @throws si la génération échoue ou si la réponse n'est pas une image valide
 */
async function generateImage(prompt, { ratio = "1:1", format = "jpg", timeoutMs = 45000 } = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt d'image vide");
  }

  const res = await axios.post(
    `${IMAGE_GEN_URL}/generate`,
    { prompt: String(prompt).trim(), ratio, format },
    { responseType: "arraybuffer", timeout: timeoutMs, maxContentLength: Infinity }
  );

  const buf = Buffer.from(res.data);

  // Vérifier les octets magiques pour s'assurer que c'est bien une image
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";

  if (!isJpeg && !isPng && !isWebp) {
    throw new Error("la génération n'a pas renvoyé une image valide");
  }

  return {
    buffer: buf,
    contentType: isJpeg ? "image/jpeg" : isPng ? "image/png" : "image/webp",
    filename: isJpeg ? "generated.jpg" : isPng ? "generated.png" : "generated.webp",
  };
}

module.exports = { generateImage, IMAGE_GEN_URL };
