/**
 * api/stanleystawa/refill.js — Refill sécurisé avec Plafond & Cooldown Anti-Abus
 */

const accountPool = require("../../lib/accountPool");
const turso = require("../../lib/turso");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 1. Authentification stricte par clé API
  if (!security.isAuthorized(req)) {
    return res.status(401).json({
      error: "Accès refusé : Clé API secrète requise pour la gestion du cluster de comptes."
    });
  }

  // 2. Vérification des quotas du pool et cooldown anti-abus
  try {
    const accounts = await turso.getActiveAccounts();
    const refillCheck = security.checkRefillAllowed(accounts.length);

    if (!refillCheck.allowed) {
      return res.status(429).json({
        error: refillCheck.reason,
        active_accounts_count: accounts.length,
        max_pool_limit: security.MAX_ACCOUNT_POOL_LIMIT
      });
    }

    const newAcc = await accountPool.createNewAccount();
    return res.status(200).json({
      status: "success",
      message: "Nouveau compte créé via TempMail et stocké dans Turso DB",
      account: {
        email: newAcc.email,
        credits: newAcc.credits
      },
      active_accounts_count: accounts.length + 1,
      max_pool_limit: security.MAX_ACCOUNT_POOL_LIMIT
    });
  } catch (err) {
    console.error("[API Refill Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
