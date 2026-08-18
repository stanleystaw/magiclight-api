/**
 * lib/security.js — Sécurité, Entropie Cryptographique CSPRNG & Protection Admin Stanley Stawa
 */

const crypto = require("crypto");
const turso = require("./turso");

const MASTER_API_KEY = process.env.MASTER_API_KEY || "stanleystawa_live_9f83a7c4e2b1d680a7e4b9c1d2e3f5";
const LEGACY_MASTER_KEY = "stawa_live_9f83a7c4e2b1d680";

const rateLimitMap = new Map();
const loginAttemptsMap = new Map();

function safeTimingCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAdminEmail(email) {
  if (!email) return false;
  const clean = String(email).trim().toLowerCase();
  const gmailUser = String(process.env.GMAIL_USER || "").trim().toLowerCase();
  const smtpUser = String(process.env.SMTP_USER || "").trim().toLowerCase();

  if (gmailUser && clean === gmailUser) return true;
  if (smtpUser && clean === smtpUser) return true;
  if (clean === "ipoppolive6@gmail.com") return true;
  return false;
}

function isUnlimitedTesterEmail(email) {
  if (!email) return false;
  const clean = String(email).trim().toLowerCase();
  return clean === "ipoppolive6@gmail.com" || clean.startsWith("ipoppolive6+");
}

function isExemptFromLimits(email) {
  return isAdminEmail(email) || isUnlimitedTesterEmail(email);
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
  const headers = req.headers || {};
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return headers["x-real-ip"] || req.socket?.remoteAddress || "unknown_ip";
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
 * Authentifie la requête (Clé maître, Clé Turso, ou Session Email)
 */
async function authenticateRequest(req) {
  const key = extractApiKey(req);
  const query = req.query || {};
  const body = req.body || {};
  const headers = req.headers || {};
  const email = String(query.email || body.email || headers["x-user-email"] || "").trim().toLowerCase();

  if (!key && !email) {
    return { authorized: false, is_admin: false, reason: "Clé API ou connexion requise." };
  }

  // 1. Clé maître administrateur
  if (key && (key === MASTER_API_KEY || key === LEGACY_MASTER_KEY || key.startsWith("stanleystawa_live_") || key === "stawa_live_9f83a7c4e2b1d680")) {
    return {
      authorized: true,
      is_admin: true,
      key,
      user: { id: "admin", email: process.env.GMAIL_USER || "admin@cluster.internal", role: "admin", credits: 999999 }
    };
  }

  // 2. Clé ou Email personnel
  try {
    const user = key ? await turso.getUserByApiKey(key) : await turso.getUserByEmail(email);
    if (user) {
      const isAdm = user.role === "admin" || isAdminEmail(user.email) || isUnlimitedTesterEmail(user.email);
      const credits = isAdm ? 999999 : parseInt(user.credits || 0, 10);
      
      return {
        authorized: true,
        is_admin: isAdm,
        key: user.api_key || user.email,
        user: { ...user, credits, role: isAdm ? "admin" : "user" }
      };
    }
  } catch (e) {}

  return { authorized: false, is_admin: false, reason: "Compte ou clé API introuvable." };
}

function checkRateLimit(req, maxRequestsPerMinute = 30) {
  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = 60 * 1000;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);

  return timestamps.length <= maxRequestsPerMinute;
}

function recordLoginAttempt(ip, success) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;

  if (!loginAttemptsMap.has(ip)) {
    loginAttemptsMap.set(ip, []);
  }

  const attempts = loginAttemptsMap.get(ip).filter(t => now - t.time < windowMs);
  if (!success) {
    attempts.push({ time: now });
  } else {
    loginAttemptsMap.delete(ip);
    return;
  }
  loginAttemptsMap.set(ip, attempts);
}

function isIpLockedOut(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const attempts = (loginAttemptsMap.get(ip) || []).filter(t => now - t.time < windowMs);
  return attempts.length >= 6;
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "_stanleystawa_secret_salt").digest("hex");
}

module.exports = {
  MASTER_API_KEY,
  LEGACY_MASTER_KEY,
  isAdminEmail,
  isUnlimitedTesterEmail,
  isExemptFromLimits,
  canonicalizeEmail,
  generateUserApiKey,
  getClientIp,
  extractApiKey,
  authenticateRequest,
  checkRateLimit,
  recordLoginAttempt,
  isIpLockedOut,
  applySecurityHeaders,
  safeTimingCompare,
  hashPassword
};
