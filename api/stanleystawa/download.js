/**
 * api/stanleystawa/download.js — Téléchargement & Streaming direct du fichier MP4 HD
 *
 * GET /stanleystawa/download?task_id=...
 */

const turso = require("../../lib/turso");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || """";
const REPO = "foctaveluka-eng/vercel-animate-api";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const taskId = params.task_id || params.taskId || params.id;

    if (!taskId) {
      return res.status(400).json({ error: "Le paramètre 'task_id' est requis." });
    }

    // 1. Cherche l'asset dans la release GitHub
    const releaseRes = await (await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v1.0.0-videos`, {
      headers: { "Authorization": `token ${GITHUB_TOKEN}`, "User-Agent": "Mozilla/5.0" }
    })).json();

    const asset = (releaseRes.assets || []).find(a => a.name === `${taskId}.mp4` || a.name.includes(taskId));

    if (!asset) {
      return res.status(404).json({ error: "Vidéo en cours de traitement ou introuvable." });
    }

    // 2. Téléchargement du binaire MP4
    const assetRes = await fetch(asset.url, {
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/octet-stream",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const arrayBuffer = await assetRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `inline; filename="${taskId}.mp4"`);
    res.setHeader("Cache-Control", "public, max-age=86400");

    return res.status(200).send(buffer);

  } catch (err) {
    console.error("[Download Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
