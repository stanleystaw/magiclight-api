/**
 * api/stanleystawa/video.js — Déclencheur vidéo ultra-rapide avec sauvegarde Turso et dispatch GitHub
 */

const turso = require("../../lib/turso");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "xR2NKjc2PgzOl0kmCQSjy7nEVvAIQw0ue3HS");
const REPO = "foctaveluka-eng/magiclight-api";
const WORKFLOW_ID = "332930279";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.text || params.idea || "").trim();
    const initialImage = (params.initialImage || params.initial_image || params.image || params.imageUrl || "").trim();
    const sections = String(params.sections || params.scenes || "4");
    const quality = String(params.quality || "medium"); // low, medium, high
    const duration = String(params.duration || "10");
    const ratio = params.ratio || "1";
    const language = params.language || "french";

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' ou 'text' est requis." });
    }

    const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Enregistrement sécurisé dans Turso DB (avec l'image initiale, même en base64 volumineuse)
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, initial_image, status, progress, step, message)
      VALUES (?, ?, ?, 'queued', 10, 'queued', 'Initialisation du rendu vidéo...');
    `;
    await turso.execute(sql, [taskId, prompt, initialImage]);

    // 2. Déclenchement garanti du worker GitHub Actions
    const ghHeaders = {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "MagicLight-Vercel-API",
      "Content-Type": "application/json"
    };

    // Si initialImage est une URL http courte, on la passe dans les inputs, sinon chaîne vide (le worker la lit depuis Turso DB)
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
            ratio: String(ratio),
            language,
            sections: String(sections),
            quality: String(quality),
            duration: String(duration)
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

    return res.status(200).json({
      status: "queued",
      task_id: taskId,
      sections: parseInt(sections, 10),
      quality: quality,
      duration_per_section: parseInt(duration, 10),
      character_image: initialImage ? "Fournie (obligatoire pour le projet)" : "Génération IA",
      check_url: checkUrl,
      message: `Rendu initié (${sections} sections, qualité ${quality}) avec animation Text-to-Video et filigrane dynamique 'Stanley stawa'.`
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
