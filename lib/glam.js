/**
 * lib/glam.js — Logique cœur : claim de pièces, création du job vidéo, statut.
 * Aucun fichier écrit sur disque : l'image est streamée URL -> Glam (compatible serverless).
 * Si imageUrl est absent, une image par défaut embarquée est utilisée.
 */
const axios = require("axios");
const FormData = require("form-data");
const { getDefaultImageStream } = require("./default-image");
const { generateImage } = require("./imagegen");

const UA = "Glam/1.58.4 Android/32 (Samsung SM-A156E)";
const REWARD_URL = "https://api.getglam.app/rewards/claim/hdnu30r7auc4kve";
const MAGIC_VIDEO_URL = "https://android.getglam.app/v2/magic_video";

const DURATIONS = [5, 10];
const QUALITIES = ["low", "medium", "high"];

/**
 * Normalise la durée. "seconds" est accepté comme alias.
 * @returns {number} 5 ou 10 (défaut 10)
 */
function normalizeDuration(d) {
  const n = parseInt(d, 10);
  return DURATIONS.includes(n) ? n : 10;
}

/**
 * Normalise la qualité.
 * NOTE (testé en réel, budget = 10 pièces/job) :
 *  - low    : modificateur low  -> coût 10 (10s) — OK
 *  - medium : PAS de modificateur (sortie identique, coût 10 (10s)) — OK
 *  - high   : modificateur high -> coût 40 (10s) -> dépasse le budget -> erreur "failed to charge"
 * @returns {string|null} modificateur de qualité à envoyer
 */
function normalizeQuality(q) {
  const v = String(q || "").toLowerCase();
  if (!QUALITIES.includes(v)) return null; // défaut : aucun modificateur
  if (v === "medium") return null; // medium = comportement par défaut gratuit
  return v; // "low" ou "high"
}

function generateRandomId(len = 16) {
  const chars = "abcdef0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Crée un "pack" (faux user) et récupère la récompense gratuite (10 pièces).
 * @returns {Promise<string>} pack id
 */
async function claimCoins() {
  const pack = generateRandomId();
  const res = await axios.post(REWARD_URL, null, {
    headers: {
      "User-Agent": UA,
      "glam-user-id": pack,
      "user_id": pack,
      "glam-local-date": new Date().toISOString(),
    },
    timeout: 15000,
  });

  const rewards = Array.isArray(res.data) ? res.data : [];
  const day1 = rewards.find((r) => r.id === "hdnu30r7auc4kve");
  if (!day1 || day1.status !== "claimed") {
    throw new Error("reward claim failed (rate limit ou réseau)");
  }
  return pack;
}

/**
 * Options multipart (filename + contentType) nécessaires pour que l'API Glam
 * reconnaisse le fichier comme une UploadFile (sinon erreur 422).
 * @param {string} [imageUrl]
 * @returns {{filename: string, contentType: string}}
 */
function getFileOptions(imageUrl) {
  let ext = "png";
  const m = /\.(jpe?g|png|webp|gif|bmp)$/i.exec(imageUrl || "");
  if (m) ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const contentType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return { filename: `image.${ext}`, contentType };
}

/**
 * Résout l'image source dans l'ordre :
 *   1. imageUrl fourni  -> téléchargé (stream)
 *   2. sinon            -> générée depuis le prompt (si autoImage)
 *   3. sinon            -> image par défaut embarquée
 * @param {{imageUrl?: string, prompt?: string, autoImage?: boolean}} params
 * @returns {Promise<{stream?: import("stream").Readable, buffer?: Buffer, filename: string, contentType: string, source: "url"|"generated"|"default"}>}
 */
async function resolveImageSource({ imageUrl, prompt, autoImage = true } = {}) {
  // 1) image fournie par URL
  if (/^https?:\/\//i.test(imageUrl || "")) {
    try {
      const res = await axios.get(imageUrl, { responseType: "stream", timeout: 30000 });
      return {
        stream: res.data,
        ...getFileOptions(imageUrl),
        source: "url",
      };
    } catch (e) {
      console.error("resolveImageSource: imageUrl invalide:", e.message);
    }
  }

  // 2) génération d'image depuis le prompt
  if (autoImage && prompt && String(prompt).trim()) {
    try {
      const img = await generateImage(prompt);
      console.log("resolveImageSource: image générée depuis le prompt");
      return {
        buffer: img.buffer,
        filename: img.filename,
        contentType: img.contentType,
        source: "generated",
      };
    } catch (e) {
      console.error("resolveImageSource: échec de la génération d'image:", e.message);
    }
  }

  // 3) image par défaut
  return {
    stream: getDefaultImageStream(),
    filename: "default.png",
    contentType: "image/png",
    source: "default",
  };
}

/**
 * Source de l'image : URL distante, ou image par défaut si imageUrl absent/indisponible.
 * @returns {Promise<import("stream").Readable>}
 */
async function getImageStream(imageUrl) {
  const src = await resolveImageSource({ imageUrl });
  return src.stream || src.buffer;
}

/**
 * Crée le job de génération vidéo.
 * @param {{imageUrl?: string, prompt: string, duration?: number, quality?: string, autoImage?: boolean, imagePrompt?: string}} params
 * @returns {Promise<{eventId: string, pack: string, charged: number, balance: number, status: string, imageSource: "url"|"generated"|"default"}>}
 */
async function createJob({ imageUrl, prompt, duration = 10, quality, autoImage = true, imagePrompt } = {}) {
  const pack = await claimCoins();
  const src = await resolveImageSource({
    imageUrl,
    prompt: imagePrompt || prompt, // prompt dédié à la génération d'image si fourni
    autoImage,
  });

  const form = new FormData();
  form.append("package_id", pack);
  form.append("media_file", src.stream || src.buffer, { filename: src.filename, contentType: src.contentType });
  form.append("media_type", "image");
  form.append("template_id", "community_img2vid");
  form.append("template_category", "20_coins_dur");

  const rateModifiers = { duration: `${normalizeDuration(duration)}s` };
  const qualityMod = normalizeQuality(quality);
  if (qualityMod) rateModifiers.quality = qualityMod;

  form.append(
    "frames",
    JSON.stringify([
      {
        prompt,
        custom_prompt: prompt,
        start: 0,
        end: 0,
        timings_units: "frames",
        media_type: "image",
        style_id: "chained_falai_img2video",
        rate_modifiers: rateModifiers,
      },
    ])
  );

  const res = await axios.post(MAGIC_VIDEO_URL, form, {
    headers: { ...form.getHeaders(), "User-Agent": UA },
    timeout: 60000,
    maxContentLength: Infinity,
  });

  const d = res.data || {};
  if (!d.event_id) {
    // ex. {"detail":"failed to charge"} -> budget pièces insuffisant
    throw new Error("upload failed" + (d.detail ? ": " + d.detail : "") + " " + JSON.stringify(d).slice(0, 200));
  }

  return {
    eventId: d.event_id,
    pack,
    charged: d.charged,
    balance: d.user_info && d.user_info.balance,
    status: d.status || "IN_PROGRESS",
    imageSource: src.source,
  };
}

/**
 * Interroge le statut d'un job.
 * @returns {Promise<{status: string, videoUrl: string|null, error: string|null, eventId: string}>}
 */
async function getJobStatus(pack, eventId) {
  const res = await axios.get(MAGIC_VIDEO_URL, {
    params: { package_id: pack, event_id: eventId },
    headers: { "User-Agent": UA },
    timeout: 15000,
  });
  const d = res.data || {};
  return {
    status: d.status || "UNKNOWN",
    videoUrl: d.video_url || null,
    error: d.error || null,
    eventId: d.event_id || eventId,
  };
}

/**
 * Boucle d'attente avec budget de temps.
 * @param {string} pack
 * @param {string} eventId
 * @param {{maxWaitMs?: number, intervalMs?: number}} [opts]
 * @returns {Promise<{status:string, videoUrl:string}>}
 * @throws {Error} code "TIMEOUT" si dépassement du budget
 */
async function waitForJob(pack, eventId, { maxWaitMs = 50000, intervalMs = 3000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    const job = await getJobStatus(pack, eventId);
    if (job.status === "READY") return job;
    if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(job.status)) {
      const err = new Error("generation failed: " + job.status);
      err.code = "GENERATION_FAILED";
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const err = new Error("timeout waiting for video");
  err.code = "TIMEOUT";
  throw err;
}

module.exports = {
  UA,
  DURATIONS,
  QUALITIES,
  normalizeDuration,
  normalizeQuality,
  generateRandomId,
  claimCoins,
  getImageStream,
  resolveImageSource,
  createJob,
  getJobStatus,
  waitForJob,
};
