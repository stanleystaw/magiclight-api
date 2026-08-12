/**
 * api/index.js — Page d'accueil et documentation / Dashboard de l'API
 */

const fs = require("fs");
const path = require("path");

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Si le client demande du JSON explicitement
  const accept = req.headers["accept"] || "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return res.status(200).json({
      name: "MagicLight AI Serverless API",
      status: "online",
      author: "stanleystawa",
      database: "Turso libSQL",
      features: [
        "Vidéos complètes générées par MagicLight AI (sans filigrane)",
        "Mode Scénario IA (Story Expand 10-15 scènes)",
        "Génération et retouche d'images",
        "Synthèse vocale (TTS)",
        "Mutualisation et auto-création de comptes (Turso DB)"
      ],
      endpoints: {
        video: "/stanleystawa/video?prompt=...&mode=expand&format=mp4",
        image: "/stanleystawa/image?prompt=...&ratio=1",
        edit: "/stanleystawa/edit?imageUrl=...&prompt=...",
        story: "/stanleystawa/story?idea=...&language=french",
        voice: "/stanleystawa/voice?text=...&format=audio",
        accounts: "/stanleystawa/accounts",
        refill: "/stanleystawa/refill"
      }
    });
  }

  // Par défaut : envoi de l'interface graphique de test (public/index.html)
  try {
    const htmlPath = path.join(__dirname, "../public/index.html");
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html);
    }
  } catch (err) {
    console.error("Erreur lecture index.html:", err);
  }

  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ status: "online", service: "MagicLight API" });
};
