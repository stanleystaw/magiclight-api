/**
 * lib/security.js — Système de Sécurité Anti-Fraude, Authentification Utilisateurs & Rate Limiting
 */

const crypto = require("crypto");
const turso = require("./turso");

const MASTER_API_KEY = process.env.STANLEY_API_KEY || process.env.API_KEY || "stawa_live_9f83a7c4e2b1d680";
const MAX_ACCOUNT_POOL_LIMIT = 10;
const REFILL_COOLDOWN_MS = 60000;

let lastRefillTimestamp = 0;
const ipRequestHistory = new Map();

function hashPassword(password) {
  const salt = "stanley_stawa_secure_salt_2026";
  return crypto.createHash("sha256").update(password + salt).digest("hex");
}

function generateUserApiKey() {
  return `stawa_usr_${crypto.randomBytes(12).toString("hex")}`;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown_ip";
}

function extractApiKey(req) {
  const query = req.query || {};
  const body = req.body || {};
  const headers = req.headers || {};

  const fromHeader = headers["x-api-key"] || headers["x-stanley-key"];
  if (fromHeader) return String(fromHeader).trim();

  const authHeader = headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const fromQuery = query.key || query.apiKey || query.api_key;
  if (fromQuery) return String(fromQuery).trim();

  const fromBody = body.key || body.apiKey || body.api_key;
  if (fromBody) return String(fromBody).trim();

  return null;
}

/**
 * Vérifie l'authentification (Clé Maître ou Clé Utilisateur Turso)
 * @returns {Promise<{ authorized: boolean, is_admin: boolean, user?: object, key?: string }>}
 */
async function authenticateRequest(req) {
  const key = extractApiKey(req);
  if (!key) {
    return { authorized: false, is_admin: false };
  }

  // 1. Clé maître administrateur / bot Facebook
  if (key === MASTER_API_KEY) {
    return {
      authorized: true,
      is_admin: true,
      key,
      user: { email: "admin@stanleystawa.com", role: "admin", credits: 99999 }
    };
  }

  // 2. Clé personnelle utilisateur
  try {
    const user = await turso.getUserByApiKey(key);
    if (user) {
      const credits = parseInt(user.credits || 0, 10);
      if (credits <= 0) {
        return {
          authorized: false,
          is_admin: false,
          reason: "Solde de crédits épuisé. Veuillez recharger votre compte."
        };
      }
      return {
        authorized: true,
        is_admin: user.role === "admin",
        key,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          credits
        }
      };
    }
  } catch (err) {
    console.warn("[Auth Check Error]", err.message);
  }

  return { authorized: false, is_admin: false };
}

/**
 * Version synchrone simplifiée si besoin
 */
function isAuthorized(req) {
  const key = extractApiKey(req);
  return key === MASTER_API_KEY || (key && key.startsWith("stawa_usr_"));
}

function checkRateLimit(req, maxPerMinute = 20) {
  const ip = getClientIp(req);
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  if (!ipRequestHistory.has(ip)) {
    ipRequestHistory.set(ip, [now]);
    return true;
  }

  const timestamps = ipRequestHistory.get(ip).filter(t => t > oneMinuteAgo);
  if (timestamps.length >= maxPerMinute) {
    return false;
  }

  timestamps.push(now);
  ipRequestHistory.set(ip, timestamps);
  return true;
}

function checkRefillAllowed(currentActiveCount = 0) {
  const now = Date.now();

  if (currentActiveCount >= MAX_ACCOUNT_POOL_LIMIT) {
    return {
      allowed: false,
      reason: `Le pool a atteint sa capacité maximale sécurisée (${MAX_ACCOUNT_POOL_LIMIT} comptes actifs).`
    };
  }

  if (now - lastRefillTimestamp < REFILL_COOLDOWN_MS) {
    const waitSec = Math.ceil((REFILL_COOLDOWN_MS - (now - lastRefillTimestamp)) / 1000);
    return {
      allowed: false,
      reason: `Délai anti-spam actif. Veuillez patienter encore ${waitSec}s.`
    };
  }

  lastRefillTimestamp = now;
  return { allowed: true };
}

module.exports = {
  MASTER_API_KEY,
  MAX_ACCOUNT_POOL_LIMIT,
  hashPassword,
  generateUserApiKey,
  getClientIp,
  extractApiKey,
  authenticateRequest,
  isAuthorized,
  checkRateLimit,
  checkRefillAllowed
};


function applySecurityHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

module.exports.applySecurityHeaders = applySecurityHeaders;
