/**
 * api/stanleystawa/status.js — Suivi en temps réel de l'état des vidéos & images (Turso DB)
 *
 * GET /stanleystawa/status?task_id=...
 * GET /stanleystawa/status?task_id=...&format=mp4
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!security.checkRateLimit(req, 60)) {
    return res.status(429).json({ error: "Trop de requêtes de statut. Veuillez patienter." });
  }
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const taskId = params.task_id || params.taskId || params.id || params.project_id;
    const format = String(params.format || "").toLowerCase();

    if (!taskId) {
      return res.status(400).json({ error: "Le paramètre 'task_id' est requis." });
    }

    const rows = await turso.execute(`SELECT * FROM video_tasks WHERE task_id = ?;`, [taskId]);
    
    if (!rows.length) {
      if (format === "mp4" || format === "redirect") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(`
          <html>
            <head><meta http-equiv="refresh" content="3"><title>Génération de votre vidéo...</title></head>
            <body style="background:#0b0f19;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;gap:12px;">
              <div style="font-size:18px;font-weight:bold;">⚡ Initialisation du rendu vidéo (${taskId})...</div>
              <div style="color:#9ca3af;font-size:14px;">Cette page se rechargera automatiquement dès que la vidéo sera prête.</div>
            </body>
          </html>
        `);
      }
      return res.status(200).json({
        status: "processing",
        progress: 15,
        step: "queued",
        message: "Tâche en file d'attente sur les serveurs..."
      });
    }

    const task = rows[0];

    // Redirection directe vers le streaming MP4 si format=mp4 et vidéo terminée
    if ((format === "mp4" || format === "redirect") && task.status === "completed" && task.video_url) {
      return res.redirect(302, task.video_url);
    }

    // Si format=mp4 mais pas encore terminé, afficher une page d'attente auto-actualisée
    if (format === "mp4" || format === "redirect") {
      if (task.status === "failed") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(500).send(`
          <html>
            <body style="background:#0b0f19;color:#ef4444;font-family:sans-serif;padding:30px;">
              <h2>❌ Échec du rendu</h2>
              <p>${task.error || task.message || "Erreur de traitement"}</p>
            </body>
          </html>
        `);
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(`
        <html>
          <head><meta http-equiv="refresh" content="4"><title>Rendu en cours (${task.progress || 20}%)...</title></head>
          <body style="background:#0b0f19;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;gap:14px;text-align:center;">
            <div style="font-size:20px;font-weight:bold;">🎬 Production de votre vidéo (${task.progress || 20}%)...</div>
            <div style="color:#818cf8;font-size:14px;">${task.message || "Animation des scènes IA en cours..."}</div>
            <div style="width:280px;height:6px;background:rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;">
              <div style="width:${task.progress || 20}%;height:100%;background:#6366f1;"></div>
            </div>
            <div style="color:#6b7280;font-size:12px;">Redirection automatique vers le lecteur dès la fin du rendu...</div>
          </body>
        </html>
      `);
    }

    return res.status(200).json({
      status: task.status, // "queued" | "processing" | "completed" | "failed"
      progress: parseInt(task.progress || 10, 10),
      step: task.step,
      message: task.message,
      video_url: task.video_url || null,
      cover_url: task.cover_url ? `https://${req.headers.host || "magiclight-api.vercel.app"}/stanleystawa/image?prompt=${encodeURIComponent(task.prompt)}&format=image` : null,
      duration: parseFloat(task.duration || 0),
      scenes_count: parseInt(task.scenes_count || 0, 10),
      error: task.error || null,
      created_at: task.created_at,
      updated_at: task.updated_at
    });

  } catch (err) {
    console.error("[API Status Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
