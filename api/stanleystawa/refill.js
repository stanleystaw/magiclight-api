/**
 * api/stanleystawa/refill.js — Refill automatique ou manuel d'un compte MagicLight vers Turso DB
 */

const accountPool = require("../../lib/accountPool");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const newAcc = await accountPool.createNewAccount();
    return res.status(200).json({
      status: "success",
      message: "Nouveau compte créé via TempMail et stocké dans Turso DB",
      account: {
        email: newAcc.email,
        credits: newAcc.credits
      }
    });
  } catch (err) {
    console.error("[API Refill Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
