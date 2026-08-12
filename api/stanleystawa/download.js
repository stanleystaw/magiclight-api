/**
 * api/stanleystawa/download.js — GET /stanleystawa/download?pack=..&eventId=..
 * Dernière étape du flux asynchrone :
 *   - READY       -> 302 vers l'URL MP4 (le client « reçoit la vidéo »)
 *   - IN_PROGRESS -> 202 JSON avec checkUrl
 *   - FAILED      -> 502 JSON
 */
const { getJobStatus } = require("../../lib/glam");

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.end(JSON.stringify(body));
}

function isAuthorized(req) {
  const key = process.env.API_KEY;
  if (!key) return true;
  const given = (req.headers && req.headers["x-api-key"]) || (req.query && req.query.key);
  return !!given && given === key;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});

  if (!isAuthorized(req)) return json(res, 401, { error: "unauthorized" });

  const q = req.query || {};
  const { pack, eventId } = q;
  if (!pack || !eventId) {
    return json(res, 400, { error: "pack et eventId sont requis" });
  }

  try {
    const job = await getJobStatus(pack, eventId);
    if (job.status === "READY") {
      res.statusCode = 302;
      res.setHeader("Location", job.videoUrl);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.end();
    }
    if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(job.status)) {
      return json(res, 502, { status: job.status, error: "génération échouée" });
    }
    const base = req.headers && req.headers.host ? `https://${req.headers.host}` : "";
    return json(res, 202, {
      status: job.status,
      checkUrl: `${base}/stanleystawa/status?pack=${pack}&eventId=${eventId}`,
    });
  } catch (err) {
    console.error("api/stanleystawa/download error:", err.message);
    return json(res, 502, { error: err.message || "erreur interne" });
  }
};
