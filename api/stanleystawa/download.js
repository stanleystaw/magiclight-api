/**
 * api/stanleystawa/download.js — Streaming direct & Montage MP4 temps réel (20s, 60s réelles)
 * + Service d'Image de Personnage Haute Résolution .jpg
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const turso = require("../../lib/turso");
const security = require("../../lib/security");
const defaultImage = require("../../lib/default-image");

const FFMPEG_PATH = ffmpegInstaller.path;

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

    // 1. Service de l'image de référence du personnage (Lapin blanc lunettes rouges par défaut ou uploadé)
    if (reqType === "image" || reqType === "img" || reqType === "cover" || customName.endsWith(".jpg") || customName.endsWith(".png")) {
      let imageBuffer = null;
      let contentType = "image/jpeg";

      if (taskId) {
        const rows = await turso.execute(`SELECT initial_image FROM video_tasks WHERE task_id = ? LIMIT 1;`, [taskId]);
        if (rows.length && rows[0].initial_image) {
          const rawImg = rows[0].initial_image;
          if (rawImg.startsWith("data:image")) {
            const parts = rawImg.split(";base64,");
            contentType = parts[0].replace("data:", "") || "image/jpeg";
            imageBuffer = Buffer.from(parts[1], "base64");
          } else if (rawImg.startsWith("http")) {
            return res.redirect(302, rawImg);
          }
        }
      }

      if (!imageBuffer) {
        imageBuffer = defaultImage.getDefaultImageBuffer();
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", imageBuffer.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.status(200).send(imageBuffer);
    }

    // 2. Service de la vidéo MP4 (Montage réel multi-scènes 20s, 60s concaténé avec FFmpeg)
    const rows = await turso.execute(`SELECT video_url, check_url, duration, scenes_count FROM video_tasks WHERE task_id = ? LIMIT 1;`, [taskId]);
    
    if (!rows.length) {
      return res.status(404).json({ error: "Tâche vidéo introuvable." });
    }

    const task = rows[0];
    let sceneJobs = [];
    if (task.check_url && task.check_url.startsWith("[")) {
      try {
        sceneJobs = JSON.parse(task.check_url).filter(s => s.videoUrl);
      } catch (e) {}
    }

    // Si une seule scène ou pas de multi-scènes
    if (sceneJobs.length <= 1) {
      const singleUrl = (sceneJobs[0] && sceneJobs[0].videoUrl) || task.video_url;
      if (singleUrl && singleUrl.startsWith("http") && !singleUrl.includes("/stanleystawa/download")) {
        return res.redirect(302, singleUrl);
      }
    }

    // Montage réel des N scènes en un fichier MP4 unique
    const tmpDir = path.join("/tmp", `merge_${taskId}`);
    const finalMergedFile = path.join(tmpDir, `${taskId}_complete.mp4`);

    if (!fs.existsSync(finalMergedFile)) {
      fs.mkdirSync(tmpDir, { recursive: true });

      // Téléchargement des clips en parallèle
      const clipFiles = [];
      await Promise.all(
        sceneJobs.map(async (job, idx) => {
          const clipPath = path.join(tmpDir, `clip_${idx + 1}.mp4`);
          const r = await fetch(job.videoUrl);
          const buf = await r.arrayBuffer();
          fs.writeFileSync(clipPath, Buffer.from(buf));
          clipFiles[idx] = clipPath;
        })
      );

      // Fichier de concaténation
      const concatList = clipFiles.map(f => `file '${f}'`).join("\n");
      const concatPath = path.join(tmpDir, "concat.txt");
      fs.writeFileSync(concatPath, concatList);

      // Assemblage réel ultra-rapide en flux direct avec FFmpeg (< 100ms)
      execSync(`${FFMPEG_PATH} -y -f concat -safe 0 -i "${concatPath}" -c copy -movflags +faststart "${finalMergedFile}" -loglevel error`);
    }

    // Envoi du fichier MP4 monté avec support Range pour streaming
    const stat = fs.statSync(finalMergedFile);
    const fileSize = stat.size;
    const range = req.headers.range;

    const isDownload = params.dl === "1" || params.download === "1";
    const disposition = isDownload ? "attachment" : "inline";

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `${disposition}; filename="stanleystawa_film_${taskId}.mp4"`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(finalMergedFile, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "video/mp4"
      });
      return file.pipe(res);
    } else {
      res.setHeader("Content-Length", fileSize);
      res.status(200);
      return fs.createReadStream(finalMergedFile).pipe(res);
    }

  } catch (err) {
    console.error("[Download/Merge Proxy Error]", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
  }
};
