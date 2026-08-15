/**
 * api/stanleystawa/status.js — Suivi en temps réel de l'état des vidéos avec réparation automatique et polling direct
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!security.checkRateLimit(req, 90)) {
    return res.status(429).json({ error: "Trop de requêtes de statut. Veuillez patienter." });
  }

  const host = req.headers.host || "magiclight-api.vercel.app";
  const protocol = req.headers["x-forwarded-proto"] || "https";

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
            <body style="background:#0b0e14;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;gap:12px;">
              <div style="font-size:18px;font-weight:bold;">Initialisation du rendu (${taskId})...</div>
              <div style="color:#8b949e;font-size:14px;">Actualisation automatique en cours...</div>
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

    let task = rows[0];

    // 1. Auto-réparation si la tâche est orpheline / sans check_url
    if ((task.status === "queued" || task.status === "processing") && (!task.check_url || task.check_url === "")) {
      try {
        const publicCharImgUrl = (task.initial_image && task.initial_image.startsWith("http"))
          ? task.initial_image
          : `${protocol}://${host}/stanleystawa/download?task_id=${taskId}&type=image`;

        const animUrl = `https://vercel-animate-api.vercel.app/stanleystawa/video?prompt=${encodeURIComponent(task.prompt || "Animation IA")}&imageUrl=${encodeURIComponent(publicCharImgUrl)}&duration=10&quality=medium&format=json`;
        const animRes = await fetch(animUrl, { signal: AbortSignal.timeout(6000) });
        if (animRes.ok) {
          const animData = await animRes.json();
          if (animData.checkUrl) {
            task.check_url = animData.checkUrl;
            task.status = "processing";
            task.progress = 25;
            task.step = "animating";
            task.message = "Animation IA en cours sur les clusters distants...";
            await turso.execute(`UPDATE video_tasks SET check_url = ?, status = 'processing', progress = 25, step = 'animating', message = ? WHERE task_id = ?;`, [animData.checkUrl, task.message, taskId]);
          }
        }
      } catch (repairErr) {
        console.warn("[Auto-Repair Warning]:", repairErr.message);
      }
    }

    // 2. Polling actif du cluster d'animation Stanley
    if ((task.status === "queued" || task.status === "processing") && task.check_url) {
      try {
        const pollRes = await fetch(task.check_url, { signal: AbortSignal.timeout(4000) });
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          if (pollData.status === "READY" && pollData.videoUrl) {
            await turso.execute(
              `UPDATE video_tasks SET status='completed', progress=100, step='finished', message='Film IA finalisé avec succès !', video_url=?, duration=10, updated_at=CURRENT_TIMESTAMP WHERE task_id=?;`,
              [pollData.videoUrl, taskId]
            );
            task.status = "completed";
            task.progress = 100;
            task.step = "finished";
            task.message = "Film IA finalisé avec succès !";
            task.video_url = pollData.videoUrl;
            task.duration = 10;
          } else if (pollData.status === "IN_PROGRESS") {
            const createdAtMs = new Date(task.created_at || Date.now()).getTime();
            const elapsedSec = Math.floor((Date.now() - createdAtMs) / 1000);
            const dynamicProg = Math.min(92, Math.max(25, 25 + Math.floor(elapsedSec * 1.6)));
            task.status = "processing";
            task.progress = dynamicProg;
            task.step = "animating";
            task.message = `Animation IA en cours (${dynamicProg}%)...`;
            await turso.execute(`UPDATE video_tasks SET status='processing', progress=?, step='animating', message=?, updated_at=CURRENT_TIMESTAMP WHERE task_id=?;`, [dynamicProg, task.message, taskId]);
          } else if (pollData.error) {
            task.status = "failed";
            task.error = pollData.error;
          }
        }
      } catch (e) {
        console.warn("[Status Poll Animate Warning]:", e.message);
      }
    }

    // 3. Détection de dépassement de délai (timeout 8 minutes)
    if (task.status === "processing" || task.status === "queued") {
      const createdAtMs = new Date(task.created_at || Date.now()).getTime();
      const ageMs = Date.now() - createdAtMs;
      if (ageMs > 480000) { // 8 minutes
        await turso.execute(`UPDATE video_tasks SET status='failed', progress=0, step='timeout', message="Le délai de traitement a expiré. Vos crédits ont été automatiquement remboursés.", error="Délai dépassé", updated_at=CURRENT_TIMESTAMP WHERE task_id = ?;`, [taskId]);
        task.status = "failed";
        task.progress = 0;
        task.message = "Le rendu a échoué. Vos crédits ont été automatiquement remboursés.";
        task.error = "Délai de traitement dépassé.";
      }
    }

    // 4. Remboursement automatique garanti des crédits en cas d'échec
    if (task.status === "failed" && parseInt(task.refunded || 0, 10) !== 1 && task.user_key && parseInt(task.credits_deducted || 0, 10) > 0) {
      const refundAmount = parseInt(task.credits_deducted, 10);
      try {
        await turso.addUserCredits(task.user_key, refundAmount);
        await turso.execute(`UPDATE video_tasks SET refunded = 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?;`, [taskId]);
        task.refunded = 1;
        task.message = (task.message || "Échec du rendu") + ` (+${refundAmount} crédits remboursés automatiquement)`;
      } catch (refundErr) {
        console.warn("Status auto refund error:", refundErr.message);
      }
    }

    // 5. Redirection directe vers le streaming MP4 si format=mp4 et vidéo terminée
    if ((format === "mp4" || format === "redirect") && task.status === "completed" && task.video_url) {
      return res.redirect(302, task.video_url);
    }

    // 6. Si format=mp4 mais pas encore terminé, afficher une page d'attente auto-actualisée
    if (format === "mp4" || format === "redirect") {
      if (task.status === "failed") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(500).send(`
          <html>
            <body style="background:#0b0e14;color:#ffb4ab;font-family:sans-serif;padding:30px;text-align:center;">
              <h2>Échec du rendu vidéo</h2>
              <p>${task.error || task.message || "Erreur de traitement survenue."}</p>
            </body>
          </html>
        `);
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(`
        <html>
          <head><meta http-equiv="refresh" content="3"><title>Rendu en cours (${task.progress || 25}%)...</title></head>
          <body style="background:#0b0e14;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;gap:14px;text-align:center;">
            <div style="font-size:20px;font-weight:bold;">Production de votre vidéo (${task.progress || 25}%)...</div>
            <div style="color:#7cf0c4;font-size:14px;">${task.message || "Animation des scènes IA en cours..."}</div>
            <div style="width:280px;height:6px;background:rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;">
              <div style="width:${task.progress || 25}%;height:100%;background:#7cf0c4;"></div>
            </div>
            <div style="color:#8b949e;font-size:12px;">Redirection automatique dès la fin du rendu...</div>
          </body>
        </html>
      `);
    }

    const coverUrl = task.cover_url ? `${protocol}://${host}/stanleystawa/image?prompt=${encodeURIComponent(task.prompt)}&format=image` : null;

    return res.status(200).json({
      status: task.status,
      progress: parseInt(task.progress || 20, 10),
      step: task.step,
      message: task.message,
      video_url: task.video_url || null,
      cover_url: coverUrl,
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
