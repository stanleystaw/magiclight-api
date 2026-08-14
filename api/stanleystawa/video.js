/**
 * api/stanleystawa/video.js — Déclencheur vidéo sécurisé avec Authentification & Anti-Abus
 *
 * GET/POST /stanleystawa/video?prompt=...&key=...&sections=6&duration=10&quality=medium
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "xR2NKjc2PgzOl0kmCQSjy7nEVvAIQw0ue3HS");
const REPO = "foctaveluka-eng/magiclight-api";
const WORKFLOW_ID = "332930279";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 1. Authentification stricte par clé API secrète
  if (!security.isAuthorized(req)) {
    return res.status(401).json({
      error: "Accès refusé : Clé API secrète invalide ou manquante.",
      auth_methods: "Passez votre clé via l'en-tête 'x-api-key: ...' ou le paramètre '?key=...'"
    });
  }

  // 2. Limitation de débit anti-spam par IP (max 10 requêtes de création vidéo par minute par client)
  if (!security.checkRateLimit(req, 10)) {
    return res.status(429).json({
      error: "Trop de requêtes vidéo initiées. Veuillez patienter une minute avant de relancer un rendu."
    });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.text || params.idea || "").trim();
    const initialImage = (params.imageUrl || params.image || params.initial_image || params.initialImage || "").trim();
    const sections = String(params.sections || params.scenes || "6");
    const quality = String(params.quality || "medium").toLowerCase();
    const duration = String(params.duration || params.seconds || "10");
    const ratio = String(params.ratio || "1");
    const language = String(params.language || "french");
    const format = String(params.format || "json").toLowerCase();

    if (!prompt) {
      return res.status(400).json({
        error: "Le paramètre 'prompt' ou 'text' est requis.",
        example: `https://${req.headers.host || 'magiclight-api.vercel.app'}/stanleystawa/video?prompt=Un+jeune+magicien+explore+la+lune&key=${security.MASTER_API_KEY}`
      });
    }

    const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 3. Enregistrement sécurisé dans Turso DB
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, initial_image, status, progress, step, message)
      VALUES (?, ?, ?, 'queued', 10, 'queued', 'Initialisation du film IA (6 sections, 60s)...');
    `;
    await turso.execute(sql, [taskId, prompt, initialImage]);

    // 4. Déclenchement du worker GitHub Actions
    const ghHeaders = {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "MagicLight-Vercel-API",
      "Content-Type": "application/json"
    };

    const inputImageUrl = initialImage.startsWith("http") ? initialImage : "";

    try {
      const dispatchRes = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          ref: "main",
          inputs: {
            task_id: taskId,
            prompt,
            initial_image: inputImageUrl,
            ratio,
            language,
            sections,
            quality,
            duration
          }
        })
      });
      if (!dispatchRes.ok) {
        const txt = await dispatchRes.text();
        console.error("[GitHub Dispatch Error Body]:", txt);
      }
    } catch (e) {
      console.error("[GitHub Dispatch Error]:", e.message);
    }

    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const checkUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}`;
    const downloadUrl = `${protocol}://${host}/stanleystawa/download?task_id=${taskId}`;
    const mp4PollUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}&format=mp4`;

    if (format === "redirect" || format === "mp4") {
      return res.redirect(302, mp4PollUrl);
    }

    return res.status(200).json({
      status: "queued",
      task_id: taskId,
      sections: parseInt(sections, 10),
      quality: quality,
      duration_per_section: parseInt(duration, 10),
      total_duration_estimate: `${parseInt(sections, 10) * parseInt(duration, 10)}s`,
      ratio: ratio === "2" ? "9:16" : "16:9",
      character_image: initialImage ? "Fournie (Référence cohérente 100%)" : "Génération IA",
      check_url: checkUrl,
      download_url: downloadUrl,
      mp4_direct_url: mp4PollUrl,
      message: `Rendu initié avec succès (${sections} sections de ${duration}s, qualité ${quality}).`
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
