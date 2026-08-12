/**
 * api/index.js — Page d'accueil et documentation de l'API
 */

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

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
};
