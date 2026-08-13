/**
 * api/stanleystawa/download.js — Streaming direct & Téléchargement MP4 Ultra-Rapide avec Support HTTP Range
 *
 * GET /stanleystawa/download?task_id=...
 */

const { Readable } = require("stream");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "xR2NKjc2PgzOl0kmCQSjy7nEVvAIQw0ue3HS");
const REPO = "foctaveluka-eng/magiclight-api";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Authorization, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

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
    const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v1.0.0-videos`, {
      headers: { "Authorization": `token ${GITHUB_TOKEN}`, "User-Agent": "MagicLight-API" }
    });

    if (!releaseRes.ok) {
      return res.status(502).json({ error: "Impossible de joindre le stockage des vidéos." });
    }

    const releaseData = await releaseRes.json();
    const asset = (releaseData.assets || []).find(a => a.name === `${taskId}.mp4` || a.name.includes(taskId));

    if (!asset) {
      return res.status(404).json({ error: "Vidéo en cours de traitement ou introuvable sur le serveur." });
    }

    // Si redirection directe demandée
    if (params.redirect === "1" || params.redirect === "true") {
      return res.redirect(302, asset.browser_download_url);
    }

    // 2. Préparation de la requête vers l'asset GitHub (avec Range forwarding)
    const forwardHeaders = {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "Accept": "application/octet-stream",
      "User-Agent": "MagicLight-API"
    };

    if (req.headers.range) {
      forwardHeaders["Range"] = req.headers.range;
    }

    const assetRes = await fetch(asset.url, { headers: forwardHeaders });

    const isDownload = params.dl === "1" || params.download === "1";
    const disposition = isDownload ? "attachment" : "inline";

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `${disposition}; filename="${taskId}.mp4"`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400");

    if (assetRes.headers.get("content-range")) {
      res.setHeader("Content-Range", assetRes.headers.get("content-range"));
    }
    if (assetRes.headers.get("content-length")) {
      res.setHeader("Content-Length", assetRes.headers.get("content-length"));
    }

    const statusCode = assetRes.status === 206 ? 206 : (req.headers.range && assetRes.status === 200 ? 200 : assetRes.status);
    res.status(statusCode);

    if (req.method === "HEAD") {
      return res.end();
    }

    // Utilisation de stream pipe si possible, ou arrayBuffer
    if (assetRes.body && typeof Readable.fromWeb === "function") {
      const stream = Readable.fromWeb(assetRes.body);
      stream.pipe(res);
    } else {
      const arrayBuffer = await assetRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }

  } catch (err) {
    console.error("[Download Streaming Error]", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
  }
};
