/**
 * lib/security.js — Système de Sécurité Anti-Fraude, Authentification & Rate Limiting
 *
 * Protège les endpoints contre :
 * 1. Les accès non autorisés (Clé API secrète x-api-key ou ?key= requise)
 * 2. Le spam et attaques par déni de service (Rate limiting par IP)
 * 3. La création abusive de comptes dans le pool Turso (Plafond strict & Cooldown)
 */

const MASTER_API_KEY = process.env.STANLEY_API_KEY || process.env.API_KEY || "stawa_live_9f83a7c4e2b1d680";
const MAX_ACCOUNT_POOL_LIMIT = 10; // Plafond maximal de comptes actifs dans le pool
const REFILL_COOLDOWN_MS = 60000; // 1 minute de cooldown entre créations de compte

let lastRefillTimestamp = 0;

// Mémoire glissante pour le rate limiting par IP
const ipRequestHistory = new Map();

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
 * Vérifie si la requête possède une clé API valide.
 */
function isAuthorized(req) {
  const key = extractApiKey(req);
  return key === MASTER_API_KEY;
}

/**
 * Rate limiter glissant par IP
 * @param {object} req 
 * @param {number} maxPerMinute 
 * @returns {boolean} true si autorisé, false si bloqué
 */
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
    return false; // Bloqué par le rate limit
  }

  timestamps.push(now);
  ipRequestHistory.set(ip, timestamps);
  return true;
}

/**
 * Vérifie si la création d'un compte est autorisée (Anti-Abus Pool)
 * @param {number} currentActiveCount 
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkRefillAllowed(currentActiveCount = 0) {
  const now = Date.now();

  if (currentActiveCount >= MAX_ACCOUNT_POOL_LIMIT) {
    return {
      allowed: false,
      reason: `Le pool a atteint sa capacité maximale sécurisée (${MAX_ACCOUNT_POOL_LIMIT} comptes actifs). Création bloquée pour éviter tout abus.`
    };
  }

  if (now - lastRefillTimestamp < REFILL_COOLDOWN_MS) {
    const waitSec = Math.ceil((REFILL_COOLDOWN_MS - (now - lastRefillTimestamp)) / 1000);
    return {
      allowed: false,
      reason: `Délai de sécurité anti-spam actif. Veuillez patienter encore ${waitSec}s avant d'ajouter un nouveau compte.`
    };
  }

  lastRefillTimestamp = now;
  return { allowed: true };
}

module.exports = {
  MASTER_API_KEY,
  MAX_ACCOUNT_POOL_LIMIT,
  getClientIp,
  extractApiKey,
  isAuthorized,
  checkRateLimit,
  checkRefillAllowed
};
