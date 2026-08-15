/**
 * api/stanleystawa/download.js — Streaming direct & Proxy Sécurisé MP4 / Images HD (Support Turso DB + Releases)
 *
 * GET /stanleystawa/download?task_id=...
 * GET /stanleystawa/download?task_id=...&type=image
 * GET /stanleystawa/download?name=...
 */

const { Readable } = require("stream");
const turso = require("../../lib/turso");
const security = require("../../lib/security");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "xR2NKjc2PgzOl0kmCQSjy7nEVvAIQw0ue3HS");
const REPO = "foctaveluka-eng/magiclight-api";

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Authorization, Content-Type, x-api-key");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!security.checkRateLimit(req, 120)) {
    return res.status(429).json({ error: "Trop de requêtes de téléchargement. Veuillez patienter." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const taskId = params.task_id || params.taskId || params.id;
    const customName = params.name || params.asset || params.file;
    const reqType = String(params.type || "").toLowerCase();

    if (!taskId && !customName) {
      return res.status(400).json({ error: "Le paramètre 'task_id' ou 'name' est requis." });
    }

    // 1. Si on demande l'image de référence du personnage pour une tâche
    if (taskId && (reqType === "image" || reqType === "img" || reqType === "cover")) {
      const rows = await turso.execute(`SELECT initial_image, cover_url FROM video_tasks WHERE task_id = ? LIMIT 1;`, [taskId]);
      if (rows.length && rows[0].initial_image) {
        const rawImg = rows[0].initial_image;
        if (rawImg.startsWith("data:image")) {
          const parts = rawImg.split(";base64,");
          const mime = parts[0].replace("data:", "") || "image/jpeg";
          const buf = Buffer.from(parts[1], "base64");
          res.setHeader("Content-Type", mime);
          res.setHeader("Content-Length", buf.length);
          res.setHeader("Cache-Control", "public, max-age=86400");
          return res.status(200).send(buf);
        } else if (rawImg.startsWith("http")) {
          return res.redirect(302, rawImg);
        }
      }
    }

    // 2. Si la tâche existe dans Turso DB avec une URL vidéo MP4 directe
    if (taskId) {
      const rows = await turso.execute(`SELECT video_url FROM video_tasks WHERE task_id = ? LIMIT 1;`, [taskId]);
      if (rows.length && rows[0].video_url && rows[0].video_url.startsWith("http")) {
        // Rediriger ou streamer l'URL vidéo finale
        return res.redirect(302, rows[0].video_url);
      }
    }

    // 3. Fallback : Cherche l'asset dans la release GitHub (si existant)
    const targetName = customName || `${taskId}.mp4`;
    const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v1.0.0-videos`, {
      headers: { "Authorization": `token ${GITHUB_TOKEN}`, "User-Agent": "MagicLight-API" }
    });

    if (releaseRes.ok) {
      const releaseData = await releaseRes.json();
      const asset = (releaseData.assets || []).find(a => a.name === targetName || (taskId && a.name.includes(taskId) && a.name.endsWith(".mp4")));

      if (asset) {
        let contentType = "video/mp4";
        if (asset.name.endsWith(".jpg") || asset.name.endsWith(".jpeg")) contentType = "image/jpeg";
        else if (asset.name.endsWith(".png")) contentType = "image/png";
        else if (asset.name.endsWith(".mp3")) contentType = "audio/mpeg";

        const forwardHeaders = {
          "Authorization": `token ${GITHUB_TOKEN}`,
          "Accept": "application/octet-stream",
          "User-Agent": "MagicLight-API"
        };

        if (req.headers.range && contentType.startsWith("video/")) {
          forwardHeaders["Range"] = req.headers.range;
        }

        const assetRes = await fetch(asset.url, { headers: forwardHeaders });
        const isDownload = params.dl === "1" || params.download === "1";
        const disposition = isDownload ? "attachment" : "inline";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `${disposition}; filename="${asset.name}"`);
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

        if (assetRes.body && typeof Readable.fromWeb === "function") {
          const stream = Readable.fromWeb(assetRes.body);
          return stream.pipe(res);
        } else {
          const arrayBuffer = await assetRes.arrayBuffer();
          return res.send(Buffer.from(arrayBuffer));
        }
      }
    }

    return res.status(404).json({ error: `Asset '${targetName}' en cours de traitement ou introuvable.` });

  } catch (err) {
    console.error("[Download/Asset Proxy Error]", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
  }
};
