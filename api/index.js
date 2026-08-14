/**
 * api/index.js — Dashboard & Console de Test Interactive Stanley Stawa AI Studio
 */

const fs = require("fs");
const path = require("path");

let htmlContent = null;
function getHtml() {
  if (!htmlContent) {
    try {
      htmlContent = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    } catch (e) {
      try {
        htmlContent = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
      } catch (err) {
        htmlContent = "<h1>★ Stanley Stawa AI Studio</h1>";
      }
    }
  }
  return htmlContent;
}

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const accept = req.headers["accept"] || "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return res.status(200).json({
      name: "Stanley Stawa AI Studio API",
      description: "Plateforme de Production Vidéo IA Multi-Scènes, Synthèse Vocale et Création Visuelle HD par Stanley Stawa.",
      status: "online",
      author: "Stanley Stawa",
      version: "3.0.0",
      watermark: "★ Stanley stawa",
      auth: {
        otp_verification: "/stanleystawa/accounts?action=send_otp",
        register: "/stanleystawa/accounts?action=register",
        login: "/stanleystawa/accounts?action=login",
        delete_account: "/stanleystawa/accounts?action=delete_account",
        me: "/stanleystawa/accounts?action=me"
      },
      endpoints: {
        video: "/stanleystawa/video?prompt=...&imageUrl=...&key=...&sections=6&duration=10&quality=medium",
        status: "/stanleystawa/status?task_id=...",
        download: "/stanleystawa/download?task_id=...",
        image: "/stanleystawa/image?prompt=...&ratio=16:9",
        edit: "/stanleystawa/edit",
        story: "/stanleystawa/story?idea=...&language=french",
        voice: "/stanleystawa/voice?text=...&format=audio",
        accounts: "/stanleystawa/accounts",
        refill: "/stanleystawa/refill"
      }
    });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(getHtml());
};
