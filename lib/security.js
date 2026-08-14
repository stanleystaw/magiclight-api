/**
 * lib/security.js — Système de Sécurité Multi-Couches, Anti-Fraude Absolu & Détection Automatique Administrateur
 */

const crypto = require("crypto");
const turso = require("./turso");

const MASTER_API_KEY = process.env.STANLEY_API_KEY || process.env.API_KEY || "stanleystawa_live_9f83a7c4e2b1d680a7e4b9c1d2e3f5";
const LEGACY_MASTER_KEY = "stawa_live_9f83a7c4e2b1d680";
const MAX_ACCOUNT_POOL_LIMIT = 10;
const REFILL_COOLDOWN_MS = 60000;

let lastRefillTimestamp = 0;
const ipRequestHistory = new Map();
const failedLoginAttempts = new Map();

function hashPassword(password) {
  const salt = "stanleystawa_crypto_salt_2026_x9f8";
  return crypto.createHash("sha256").update(password + salt).digest("hex");
}

function isAdminEmail(email) {
  if (!email) return false;
  const clean = String(email).trim().toLowerCase();
  const gmailUser = String(process.env.GMAIL_USER || "").trim().toLowerCase();
  const smtpUser = String(process.env.SMTP_USER || "").trim().toLowerCase();
  const defaultAdmin = "stanleystawa354@gmail.com";

  return (
    clean === gmailUser ||
    clean === smtpUser ||
    clean === defaultAdmin ||
    clean === "admin@stanleystawa.com" ||
    clean === "ipoppolive6@gmail.com" ||
    clean.startsWith("ipoppolive6") ||
    clean === "stawastanley2@gmail.com" ||
    clean.startsWith("stawastanley")
  );
}

function canonicalizeEmail(email) {
  if (!email || !email.includes("@")) return "";
  const [localPart, domain] = email.trim().toLowerCase().split("@");
  if (!domain) return "";

  if (domain === "gmail.com" || domain === "googlemail.com") {
    let cleanLocal = localPart.replace(/\./g, "");
    cleanLocal = cleanLocal.split("+")[0];
    return `${cleanLocal}@gmail.com`;
  }

  let cleanLocal = localPart.split("+")[0];
  return `${cleanLocal}@${domain}`;
}

function generateUserApiKey() {
  const randomEntropy = crypto.randomBytes(24).toString("hex");
  return `stanleystawa_usr_${randomEntropy}`;
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
 * Authentifie la requête (Détecte automatiquement si l'e-mail est administrateur)
 */
async function authenticateRequest(req) {
  const key = extractApiKey(req);
  if (!key) {
    return { authorized: false, is_admin: false };
  }

  // 1. Clé maître administrateur
  if (key === MASTER_API_KEY || key === LEGACY_MASTER_KEY || key.startsWith("stanleystawa_live_") || key === "stawa_live_9f83a7c4e2b1d680") {
    return {
      authorized: true,
      is_admin: true,
      key,
      user: { id: "admin", email: process.env.GMAIL_USER || "ipoppolive6@gmail.com", role: "admin", credits: 999999 }
    };
  }

  // 2. Clé personnelle utilisateur
  try {
    const user = await turso.getUserByApiKey(key);
    if (user) {
      const isAdm = user.role === "admin" || isAdminEmail(user.email);
      const credits = parseInt(user.credits || 0, 10);
      
      if (!isAdm && credits <= 0) {
        return {
          authorized: false,
          is_admin: false,
          reason: "Solde de crédits épuisé (0 crédit restant). Veuillez recharger votre compte."
        };
      }

      return {
        authorized: true,
        is_admin: isAdm,
        key,
        user: {
          id: user.id,
          email: user.email,
          role: isAdm ? "admin" : "user",
          account_type: user.account_type || "studio",
          credits: isAdm ? 999999 : credits
        }
      };
    }
  } catch (err) {
    console.warn("[Auth Check Error]", err.message);
  }

  return { authorized: false, is_admin: false };
}

function isAuthorized(req) {
  const key = extractApiKey(req);
  return key === MASTER_API_KEY || key === LEGACY_MASTER_KEY || (key && (key.startsWith("stanleystawa_") || key.startsWith("stawa_")));
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

function recordLoginAttempt(ip, success) {
  const now = Date.now();
  if (success) {
    failedLoginAttempts.delete(ip);
    return true;
  }

  const record = failedLoginAttempts.get(ip) || { count: 0, lastAttempt: now };
  record.count += 1;
  record.lastAttempt = now;
  failedLoginAttempts.set(ip, record);

  return record.count < 5;
}

function isIpLockedOut(ip) {
  const record = failedLoginAttempts.get(ip);
  if (!record) return false;
  if (record.count >= 5) {
    const lockDuration = 15 * 60000;
    if (Date.now() - record.lastAttempt < lockDuration) {
      return true;
    }
    failedLoginAttempts.delete(ip);
  }
  return false;
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

function applySecurityHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
}

module.exports = {
  MASTER_API_KEY,
  MAX_ACCOUNT_POOL_LIMIT,
  hashPassword,
  isAdminEmail,
  canonicalizeEmail,
  generateUserApiKey,
  getClientIp,
  extractApiKey,
  authenticateRequest,
  isAuthorized,
  checkRateLimit,
  recordLoginAttempt,
  isIpLockedOut,
  checkRefillAllowed,
  applySecurityHeaders
};
