/**
 * api/stanleystawa/status.js — Suivi d'avancement & Récupération de la vidéo finale MagicLight
 *
 * GET /stanleystawa/status?project_id=...&account=...
 */

const engine = require("../../lib/magiclight");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const projectId = params.project_id || params.projectId || params.id;
    const accountEmail = params.account || params.email;

    if (!projectId) {
      return res.status(400).json({ error: "Le paramètre 'project_id' est requis." });
    }

    const statusResult = await engine.checkAndUpdateVideoStatus(projectId, accountEmail);

    // Si format=mp4 et vidéo terminée, redirection directe
    if (params.format === "mp4" && statusResult.status === "success" && statusResult.video_url) {
      return res.redirect(302, statusResult.video_url);
    }

    return res.status(200).json(statusResult);
  } catch (err) {
    console.error("[API Status Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
