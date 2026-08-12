/**
 * api/index.js — Routeur Express & Point d'entrée universel Vercel
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const engine = require("../lib/magiclight");
const turso = require("../lib/turso");
const accountPool = require("../lib/accountPool");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function extractParams(req) {
  return { ...(req.query || {}), ...(req.body || {}) };
}

// 1. PAGE D'ACCUEIL / DASHBOARD
app.get("/", (req, res) => {
  const accept = req.headers["accept"] || "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return res.status(200).json({
      name: "MagicLight AI Serverless API",
      status: "online",
      author: "stanleystawa",
      database: "Turso libSQL",
      endpoints: {
        video: "/stanleystawa/video?prompt=...&mode=expand",
        status: "/stanleystawa/status?project_id=...",
        image: "/stanleystawa/image?prompt=...&ratio=1",
        edit: "/stanleystawa/edit?imageUrl=...&prompt=...",
        story: "/stanleystawa/story?idea=...&language=french",
        voice: "/stanleystawa/voice?text=...&format=audio",
        accounts: "/stanleystawa/accounts",
        refill: "/stanleystawa/refill"
      }
    });
  }

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

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send("<h1>MagicLight AI Studio en ligne</h1>");
});

// 2. VIDÉO CLOUD
const handleVideo = async (req, res) => {
  try {
    const params = extractParams(req);
    const prompt = params.prompt || params.text || params.idea;

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' ou 'text' est requis." });
    }

    const initResult = await engine.initVideoProject({
      prompt,
      text: params.text || prompt,
      title: params.title || "Vidéo MagicLight",
      mode: params.mode || "expand",
      styleId: params.styleId || params.style_id || "5001",
      language: params.language || "french",
      ratio: params.ratio || 1
    });

    const host = req.headers.host || "vercel-animate-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const checkUrl = `${protocol}://${host}/stanleystawa/status?project_id=${initResult.project_id}&account=${encodeURIComponent(initResult.account_email)}`;

    return res.status(200).json({
      status: "processing",
      project_id: initResult.project_id,
      account_email: initResult.account_email,
      check_url: checkUrl,
      message: "Projet vidéo initié sur MagicLight AI."
    });
  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
app.all("/stanleystawa/video", handleVideo);
app.all("/api/stanleystawa/video", handleVideo);

// 3. STATUT DU RENDU VIDÉO & IMAGE
const handleStatus = async (req, res) => {
  try {
    const params = extractParams(req);
    const projectId = params.project_id || params.projectId || params.id;
    const accountEmail = params.account || params.email;

    if (!projectId) {
      return res.status(400).json({ error: "Le paramètre 'project_id' est requis." });
    }

    const statusResult = await engine.checkAndUpdateVideoStatus(projectId, accountEmail);

    if (params.format === "mp4" && statusResult.status === "success" && statusResult.video_url) {
      return res.redirect(302, statusResult.video_url);
    }

    return res.status(200).json(statusResult);
  } catch (err) {
    console.error("[API Status Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
app.all("/stanleystawa/status", handleStatus);
app.all("/api/stanleystawa/status", handleStatus);

// 4. IMAGE
const handleImage = async (req, res) => {
  try {
    const params = extractParams(req);
    const prompt = params.prompt || params.text;

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' est requis." });
    }

    const result = await engine.generateImage({
      prompt,
      styleId: params.styleId || params.style_id || "5001",
      ratio: params.ratio || 1
    });

    if (params.format === "image" && result.image_url) {
      return res.redirect(302, result.image_url);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Image Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
app.all("/stanleystawa/image", handleImage);
app.all("/api/stanleystawa/image", handleImage);

// 5. EDIT
const handleEdit = async (req, res) => {
  try {
    const params = extractParams(req);
    const prompt = params.prompt || params.instructions;

    if (!prompt) {
      return res.status(400).json({ error: "Le paramètre 'prompt' est requis pour la retouche." });
    }

    const result = await engine.editImage({
      imageUrl: params.imageUrl || params.image_url,
      prompt,
      styleId: params.styleId || params.style_id || "5001"
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Edit Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
app.all("/stanleystawa/edit", handleEdit);
app.all("/api/stanleystawa/edit", handleEdit);

// 6. STORY EXPAND
const handleStory = async (req, res) => {
  try {
    const params = extractParams(req);
    const idea = params.idea || params.prompt || params.text;

    if (!idea) {
      return res.status(400).json({ error: "Le paramètre 'idea' ou 'prompt' est requis." });
    }

    const result = await engine.expandStory(
      idea,
      params.language || "french",
      params.styleId || params.style_id || "5001"
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Story Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
app.all("/stanleystawa/story", handleStory);
app.all("/api/stanleystawa/story", handleStory);

// 7. VOICE
const handleVoice = async (req, res) => {
  try {
    const params = extractParams(req);
    const text = params.text || params.prompt;

    if (!text) {
      return res.status(400).json({ error: "Le paramètre 'text' est requis." });
    }

    const result = await engine.synthesizeVoice({
      text,
      voiceId: params.voice_id || params.voiceId || "MM:lengdan_xiongzhang"
    });

    if (params.format === "audio" && result.audio_url) {
      return res.redirect(302, result.audio_url);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[API Voice Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
app.all("/stanleystawa/voice", handleVoice);
app.all("/api/stanleystawa/voice", handleVoice);

// 8. ACCOUNTS & TURSO DB
const handleAccounts = async (req, res) => {
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
app.all("/stanleystawa/accounts", handleAccounts);
app.all("/api/stanleystawa/accounts", handleAccounts);

// 9. REFILL
const handleRefill = async (req, res) => {
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
app.all("/stanleystawa/refill", handleRefill);
app.all("/api/stanleystawa/refill", handleRefill);

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Serveur actif sur http://localhost:${PORT}`);
  });
}
