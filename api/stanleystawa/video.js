/**
 * api/stanleystawa/video.js — Déclencheur ultra-rapide (< 200 ms) via GitHub Actions sur magiclight-api
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

    // 2. Déclenchement du worker GitHub Actions via workflow_dispatch
    const ghHeaders = {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "MagicLight-Vercel-API",
      "Content-Type": "application/json"
    };

    fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, {
      method: "POST",
      headers: ghHeaders,
      body: JSON.stringify({
        ref: "main",
        inputs: {
          task_id: taskId,
          prompt,
          ratio: String(ratio),
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
      message: "Rendu vidéo multi-scènes lancé sur GitHub Actions avec FFmpeg & MagicLight TTS."
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
