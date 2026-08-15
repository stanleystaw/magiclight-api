/**
 * api/stanleystawa/video.js — Moteur de Génération Vidéo IA 100% Cloud Direct
 * (ZÉRO GitHub Actions — 100% Serverless, Zéro risque de ban)
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

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

  // 2. Limitation anti-spam
  if (!security.checkRateLimit(req, 15)) {
    return res.status(429).json({
      error: "Trop de requêtes vidéo initiées. Veuillez patienter une minute avant de relancer un rendu."
    });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.text || params.idea || "").trim();
    const initialImage = (params.imageUrl || params.image || params.initial_image || params.initialImage || "").trim();
    const quality = String(params.quality || "medium").toLowerCase();
    const duration = String(params.duration || params.seconds || "10");
    const ratio = String(params.ratio || "1");
    const format = String(params.format || "json").toLowerCase();

    if (!prompt) {
      return res.status(400).json({
        error: "Le paramètre 'prompt' ou 'text' est requis.",
        example: `https://${req.headers.host || 'magiclight-api-gamma.vercel.app'}/stanleystawa/video?prompt=Un+jeune+magicien+explore+la+lune&imageUrl=https://...&key=${auth.key || security.MASTER_API_KEY}`
      });
    }

    if (!initialImage) {
      return res.status(400).json({
        error: "Une image de personnage de référence ('imageUrl' ou image uploadée) est requise pour assurer la cohérence visuelle.",
        required_field: "imageUrl"
      });
    }

    // 3. Déduction de crédits (1 crédit par vidéo)
    const creditCost = 1;
    let remainingCredits = null;

    if (!auth.is_admin && auth.key) {
      const user = await turso.getUserByApiKey(auth.key);
      const userCredits = parseInt(user?.credits || 0, 10);
      if (userCredits < creditCost) {
        return res.status(402).json({
          error: `Crédits insuffisants : La génération requiert ${creditCost} crédit (Votre solde actuel : ${userCredits} crédits).`,
          required_credits: creditCost,
          current_credits: userCredits
        });
      }
      remainingCredits = await turso.deductUserCredits(auth.key, creditCost);
    }

    const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const host = req.headers.host || "magiclight-api-gamma.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";

    // URL publique pour l'image du personnage uploadée
    const publicCharImgUrl = initialImage.startsWith("http")
      ? initialImage
      : `${protocol}://${host}/stanleystawa/download?task_id=${taskId}&type=image`;

    // 4. Appel DIRECT au Moteur d'Animation Cloud IA (ZÉRO GitHub Actions)
    let animateCheckUrl = "";
    try {
      const animUrl = `https://vercel-animate-api.vercel.app/stanleystawa/video?prompt=${encodeURIComponent(prompt)}&imageUrl=${encodeURIComponent(publicCharImgUrl)}&duration=${duration}&quality=${quality}&format=json`;
      const animRes = await fetch(animUrl, { signal: AbortSignal.timeout(10000) });
      if (animRes.ok) {
        const animData = await animRes.json();
        if (animData.checkUrl) {
          animateCheckUrl = animData.checkUrl;
          console.log(`[Cloud Video Dispatched] Task: ${taskId}, checkUrl: ${animateCheckUrl}`);
        }
      }
    } catch (e) {
      console.warn("[Cloud Animate Dispatch Note]:", e.message);
    }

    // 5. Enregistrement dans Turso DB avec checkUrl pour polling en direct
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, initial_image, status, progress, step, message, user_key, credits_deducted, refunded, duration, scenes_count, check_url)
      VALUES (?, ?, ?, 'processing', 25, 'animating', 'Génération du film IA en cours...', ?, ?, 0, 10, 1, ?);
    `;
    await turso.execute(sql, [taskId, prompt, initialImage, auth.key || "", creditCost, animateCheckUrl]);

    const checkUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}`;
    const downloadUrl = `${protocol}://${host}/stanleystawa/download?task_id=${taskId}`;
    const mp4PollUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}&format=mp4`;

    if (format === "redirect" || format === "mp4") {
      return res.redirect(302, mp4PollUrl);
    }

    return res.status(200).json({
      status: "processing",
      task_id: taskId,
      duration: parseInt(duration, 10),
      quality: quality,
      credits_deducted: creditCost,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
      ratio: ratio === "2" ? "9:16" : "16:9",
      character_image: "Fournie (Référence cohérente)",
      check_url: checkUrl,
      download_url: downloadUrl,
      mp4_direct_url: mp4PollUrl,
      engine: "Cloud GPU Direct",
      message: "Génération vidéo IA lancée avec succès !"
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
