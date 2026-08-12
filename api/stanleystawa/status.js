/**
 * api/stanleystawa/status.js — GET /stanleystawa/status?pack=..&eventId=..
 * Statut du job : IN_PROGRESS / READY (avec videoUrl) / FAILED.
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
    return json(res, 400, { error: "pack et eventId sont requis (voir checkUrl de /stanleystawa/video)" });
  }

  try {
    const job = await getJobStatus(pack, eventId);
    return json(res, job.status === "READY" ? 200 : 202, job);
  } catch (err) {
    console.error("api/stanleystawa/status error:", err.message);
    return json(res, 502, { error: err.message || "erreur interne" });
  }
};
