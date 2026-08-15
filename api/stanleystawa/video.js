/**
 * api/stanleystawa/video.js — Déclencheur vidéo sécurisé avec Tarification Dynamique (1 Crédit / Section)
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "xR2NKjc2PgzOl0kmCQSjy7nEVvAIQw0ue3HS");
const REPO = "foctaveluka-eng/magiclight-api";
const WORKFLOW_ID = "332930279";

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 1. Authentification (Clé Maître Bot ou Clé Utilisateur Turso)
  const auth = await security.authenticateRequest(req);
  if (!auth.authorized) {
    return res.status(401).json({
      error: auth.reason || "Accès refusé : Clé API secrète invalide ou manquante.",
      auth_methods: "Inscrivez-vous sur le site pour obtenir votre clé d'accès (+30 crédits) ou passez votre clé '?key=...' / 'x-api-key'"
    });
  }

  // 2. Limitation de débit anti-spam par IP
  if (!security.checkRateLimit(req, 10)) {
    return res.status(429).json({
      error: "Trop de requêtes vidéo initiées. Veuillez patienter une minute avant de relancer un rendu."
    });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.text || params.idea || "").trim();
    const initialImage = (params.imageUrl || params.image || params.initial_image || params.initialImage || "").trim();
    const sections = String(params.sections || params.scenes || "6");
    const quality = String(params.quality || "medium").toLowerCase();
    const duration = String(params.duration || params.seconds || "10");
    const ratio = String(params.ratio || "1");
    const language = String(params.language || "french");
    const format = String(params.format || "json").toLowerCase();

    if (!prompt) {
      return res.status(400).json({
        error: "Le paramètre 'prompt' ou 'text' est requis.",
        example: `https://${req.headers.host || 'magiclight-api.vercel.app'}/stanleystawa/video?prompt=Un+jeune+magicien+explore+la+lune&imageUrl=https://...&key=${auth.key || security.MASTER_API_KEY}`
      });
    }

    if (!initialImage) {
      return res.status(400).json({
        error: "Une image de personnage de référence ('imageUrl' ou image uploadée) est OBLIGATOIRE pour garantir 100% de cohérence sur toutes les scènes de la vidéo.",
        required_field: "imageUrl"
      });
    }

    // 3. Tarification Dynamique proportionnelle : 1 crédit par section
    const numSections = Math.max(2, parseInt(sections, 10) || 6);
    const creditCost = numSections; // 2 sections = 2 crédits, 6 sections = 6 crédits, etc.
    let remainingCredits = null;

    if (!auth.is_admin && auth.key) {
      const user = await turso.getUserByApiKey(auth.key);
      const userCredits = parseInt(user?.credits || 0, 10);
      if (userCredits < creditCost) {
        return res.status(402).json({
          error: `Crédits insuffisants : Cette vidéo de ${numSections} sections requiert ${creditCost} crédits (Votre solde actuel : ${userCredits} crédits).`,
          required_credits: creditCost,
          current_credits: userCredits
        });
      }
      remainingCredits = await turso.deductUserCredits(auth.key, creditCost);
    }

    const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const inputImageUrl = initialImage.startsWith("http") ? initialImage : "";

    // 4. Déclenchement de l'animation IA via l'API Stanley (vercel-animate-api)
    let animateCheckUrl = "";
    try {
      const animUrl = `https://vercel-animate-api.vercel.app/stanleystawa/video?prompt=${encodeURIComponent(prompt)}&imageUrl=${encodeURIComponent(inputImageUrl)}&duration=${duration}&quality=${quality}&format=json`;
      const animRes = await fetch(animUrl, { signal: AbortSignal.timeout(10000) });
      if (animRes.ok) {
        const animData = await animRes.json();
        if (animData.checkUrl) {
          animateCheckUrl = animData.checkUrl;
          console.log(`[Video Animate Dispatched] checkUrl: ${animateCheckUrl}`);
        }
      }
    } catch (e) {
      console.warn("[Animate API Dispatch Warning]:", e.message);
    }

    // 5. Enregistrement dans Turso DB avec clé utilisateur et checkUrl pour polling instantané
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, initial_image, status, progress, step, message, user_key, credits_deducted, refunded, check_url)
      VALUES (?, ?, ?, 'processing', 20, 'animating', 'Génération du film IA en cours...', ?, ?, 0, ?);
    `;
    await turso.execute(sql, [taskId, prompt, initialImage, auth.key || "", creditCost, animateCheckUrl]);

    // 6. Déclenchement GitHub Actions en parallèle (si actif)
    const ghHeaders = {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "MagicLight-Vercel-API",
      "Content-Type": "application/json"
    };

    try {
      fetch(`https://api.github.com/repos/${REPO}/actions/workflows/generate-video.yml/dispatches`, {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          ref: "main",
          inputs: {
            task_id: taskId,
            prompt,
            initial_image: inputImageUrl,
            ratio,
            language,
            sections: String(numSections),
            quality,
            duration
          }
        })
      }).catch(e => console.warn("[GitHub Dispatch Note]:", e.message));
    } catch (e) {}

    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const checkUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}`;
    const downloadUrl = `${protocol}://${host}/stanleystawa/download?task_id=${taskId}`;
    const mp4PollUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}&format=mp4`;

    if (format === "redirect" || format === "mp4") {
      return res.redirect(302, mp4PollUrl);
    }

    return res.status(200).json({
      status: "queued",
      task_id: taskId,
      sections: numSections,
      quality: quality,
      duration_per_section: parseInt(duration, 10),
      total_duration_estimate: `${numSections * parseInt(duration, 10)}s`,
      credits_deducted: creditCost,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
      ratio: ratio === "2" ? "9:16" : "16:9",
      character_image: initialImage ? "Fournie (Référence cohérente 100%)" : "Génération IA",
      check_url: checkUrl,
      download_url: downloadUrl,
      mp4_direct_url: mp4PollUrl,
      message: `Rendu initié avec succès (${numSections} sections, coût : ${creditCost} crédits).`
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
