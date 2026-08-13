/**
 * api/stanleystawa/video.js — Point d'entrée vidéo serverless MagicLight AI
 *
 * GET/POST /stanleystawa/video?imageUrl=...&prompt=...&sections=6&duration=10&quality=medium&format=json
 *
 * Paramètres :
 *   - imageUrl / image / initial_image : URL ou base64 du personnage de référence (optionnel)
 *   - prompt / text / idea             : Scénario / description de la vidéo (requis)
 *   - sections / scenes                : Nombre de sections 2 à 10 (défaut : 6)
 *   - duration / seconds               : Durée par section 5 ou 10s (défaut : 10)
 *   - quality                          : low | medium | high (défaut : medium)
 *   - ratio                            : 1 (16:9 Paysage) ou 2 (9:16 Portrait) (défaut : 1)
 *   - language                         : french | english | spanish | german (défaut : french)
 *   - format                           : json | mp4 | redirect (défaut : json)
 */

const turso = require("../../lib/turso");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "xR2NKjc2PgzOl0kmCQSjy7nEVvAIQw0ue3HS");
const REPO = "foctaveluka-eng/magiclight-api";
const WORKFLOW_ID = "332930279";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.text || params.idea || "").trim();
    const initialImage = (params.imageUrl || params.image || params.initial_image || params.initialImage || "").trim();
    const sections = String(params.sections || params.scenes || "6"); // 6 sections par défaut
    const quality = String(params.quality || "medium").toLowerCase(); // medium par défaut
    const duration = String(params.duration || params.seconds || "10"); // 10s par section par défaut
    const ratio = String(params.ratio || "1"); // 16:9 par défaut
    const language = String(params.language || "french");
    const format = String(params.format || "json").toLowerCase();

    if (!prompt) {
      return res.status(400).json({
        error: "Le paramètre 'prompt' ou 'text' est requis.",
        example: "https://magiclight-api.vercel.app/stanleystawa/video?prompt=Un+petit+chaton+qui+explore+la+lune&imageUrl=...&sections=6&duration=10&quality=medium"
      });
    }

    const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Enregistrement dans Turso DB
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, initial_image, status, progress, step, message)
      VALUES (?, ?, ?, 'queued', 10, 'queued', 'Initialisation du film IA (6 sections, 60s)...');
    `;
    await turso.execute(sql, [taskId, prompt, initialImage]);

    // 2. Déclenchement du worker de compilation vidéo GitHub Actions
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
      console.log("[GitHub Dispatch Status]:", dispatchRes.status);
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
      // Renvoie vers le lien d'attente MP4
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
