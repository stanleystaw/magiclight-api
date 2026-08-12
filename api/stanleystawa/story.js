/**
 * api/stanleystawa/story.js — Expansion de scénario & découpage en 10-15 scènes
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
    const idea = params.idea || params.prompt || params.text;

    if (!idea) {
      return res.status(400).json({ error: "Le paramètre 'idea' ou 'prompt' est requis." });
    }

    const result = await engine.expandStory(
      idea,
      params.language || "french",
      params.styleId || params.style_id || "5001"
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Story Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
