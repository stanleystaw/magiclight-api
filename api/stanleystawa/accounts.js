/**
 * api/stanleystawa/accounts.js — Consultation des comptes et crédits dans Turso DB
 */

const turso = require("../../lib/turso");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const accounts = await turso.getActiveAccounts();
    const totalCredits = accounts.reduce((acc, a) => acc + parseInt(a.credits || 0, 10), 0);

    return res.status(200).json({
      active_accounts_count: accounts.length,
      total_credits_pool: totalCredits,
      database: "Turso libSQL",
      accounts: accounts.map(a => ({
        email: a.email,
        credits: a.credits,
        status: a.status,
        created_at: a.created_at
      }))
    });
  } catch (err) {
    console.error("[API Accounts Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
