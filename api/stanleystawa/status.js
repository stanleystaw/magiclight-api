/**
 * api/stanleystawa/status.js — Suivi en temps réel de l'état des vidéos & images (Turso DB)
 */

const turso = require("../../lib/turso");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const taskId = params.task_id || params.taskId || params.id || params.project_id;

    if (!taskId) {
      return res.status(400).json({ error: "Le paramètre 'task_id' est requis." });
    }

    const rows = await turso.execute(`SELECT * FROM video_tasks WHERE task_id = ?;`, [taskId]);
    
    if (!rows.length) {
      return res.status(200).json({
        status: "processing",
        progress: 15,
        step: "queued",
        message: "Tâche en file d'attente sur les serveurs..."
      });
    }

    const task = rows[0];

    // Redirection directe si format=mp4 et vidéo prête
    if (params.format === "mp4" && task.status === "completed" && task.video_url) {
      return res.redirect(302, task.video_url);
    }

    return res.status(200).json({
      status: task.status, // "queued" | "processing" | "completed" | "failed"
      progress: parseInt(task.progress || 10, 10),
      step: task.step,
      message: task.message,
      video_url: task.video_url || null,
      cover_url: task.cover_url || null,
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
