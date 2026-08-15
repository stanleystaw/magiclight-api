/**
 * api/stanleystawa/download.js — Streaming direct MP4 & Service d'Images Publiques Haute Résolution
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Authorization, Content-Type, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!security.checkRateLimit(req, 120)) {
    return res.status(429).json({ error: "Trop de requêtes. Veuillez patienter." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    let taskId = params.task_id || params.taskId || params.id;
    const customName = params.name || params.asset || params.file || "";
    const reqType = String(params.type || "").toLowerCase();

    if (!taskId && customName) {
      const match = customName.match(/vid_\d+_[a-z0-9]+/i);
      if (match) taskId = match[0];
    }

    if (!taskId && !customName) {
      return res.status(400).json({ error: "Le paramètre 'task_id' est requis." });
    }

    // 1. Service de l'image de référence du personnage pour l'IA d'animation
    if (reqType === "image" || reqType === "img" || reqType === "cover" || customName.endsWith(".jpg") || customName.endsWith(".png")) {
      const rows = await turso.execute(`SELECT initial_image FROM video_tasks WHERE task_id = ? LIMIT 1;`, [taskId]);
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
      return res.status(404).json({ error: "Image du personnage introuvable." });
    }

    // 2. Service de la vidéo finale MP4
    const rows = await turso.execute(`SELECT video_url, check_url FROM video_tasks WHERE task_id = ? LIMIT 1;`, [taskId]);
    if (rows.length) {
      const task = rows[0];
      const sceneIndex = parseInt(params.scene || "1", 10) - 1;

      // Si une scène précise est demandée
      if (task.check_url && task.check_url.startsWith("[")) {
        try {
          const scenes = JSON.parse(task.check_url);
          if (scenes[sceneIndex] && scenes[sceneIndex].videoUrl) {
            return res.redirect(302, scenes[sceneIndex].videoUrl);
          }
        } catch (e) {}
      }

      if (task.video_url && task.video_url.startsWith("http")) {
        return res.redirect(302, task.video_url);
      }
    }

    return res.status(404).json({ error: "Vidéo en cours de génération ou introuvable." });

  } catch (err) {
    console.error("[Download Proxy Error]", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
  }
};
