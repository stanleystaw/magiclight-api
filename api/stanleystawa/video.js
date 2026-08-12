/**
 * api/stanleystawa/video.js — Déclencheur ultra-rapide (< 200 ms) via GitHub Actions & Turso DB
 */

const turso = require("../../lib/turso");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const REPO = "foctaveluka-eng/vercel-animate-api";

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

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' ou 'text' est requis." });
    }

    const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ratio = params.ratio || "1";
    const language = params.language || "french";

    // 1. Enregistrement initial dans Turso DB
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, status, progress, step, message)
      VALUES (?, ?, 'queued', 10, 'queued', 'Initialisation du rendu vidéo...');
    `;
    await turso.execute(sql, [taskId, prompt]);

    // 2. Déclenchement du worker GitHub Actions via repository_dispatch (< 150 ms)
    fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "MagicLight-Vercel-API",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_type: "generate-video",
        client_payload: {
          task_id: taskId,
          prompt,
          ratio,
          language
        }
      })
    }).catch(e => console.error("[GitHub Dispatch Error]", e));

    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const checkUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}`;

    return res.status(200).json({
      status: "queued",
      task_id: taskId,
      check_url: checkUrl,
      message: "Rendu vidéo multi-scènes initié sur GitHub Actions. Suivez l'avancement via 'check_url'."
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
