/**
 * api/stanleystawa/auth/me.js — Profil utilisateur & solde de crédits
 *
 * GET /stanleystawa/auth/me (avec x-api-key ou ?key=)
 */

const security = require("../../../lib/security");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const auth = await security.authenticateRequest(req);
    if (!auth.authorized) {
      return res.status(401).json({
        error: auth.reason || "Non authentifié : Clé API manquante ou invalide."
      });
    }

    return res.status(200).json({
      status: "authenticated",
      user: auth.user,
      is_admin: auth.is_admin,
      api_key: auth.key
    });

  } catch (err) {
    console.error("[Auth Me Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
