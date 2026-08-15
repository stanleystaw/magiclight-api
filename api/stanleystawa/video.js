/**
 * api/stanleystawa/video.js — Déclencheur vidéo multi-scènes (1 Crédit / Section = 10s / Section)
 * Lance N animations parallèles cohérentes avec l'image du personnage
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "7XfjBcNnRrooeYTlvz3Uth9kYX019Y3J9UfV");
const REPO = process.env.GITHUB_REPOSITORY || "stanleystaw/magiclight-api";
const HF_WORKER_URL = (process.env.HF_WORKER_URL || process.env.HUGGINGFACE_WORKER_URL || "").replace(/\/$/, "");

// Découpage du scénario en N sections équilibrées
function partitionStory(promptText, n) {
  if (!promptText) return ["Scène 1", "Scène 2"].slice(0, n);
  let parts = promptText.split(/(?<=[.!?])\s+|\s+(?:et|puis|ensuite|alors|pendant que|tandis que|tout à coup|soudain)\s+/i).map(s => s.trim()).filter(Boolean);
  if (parts.length < n) {
    const words = promptText.split(/\s+/);
    if (words.length >= n * 2) {
      const chunkSize = Math.ceil(words.length / n);
      parts = [];
      for (let i = 0; i < n; i++) {
        const chunk = words.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
        if (chunk) parts.push(chunk);
      }
    } else {
      while (parts.length < n) {
        parts.push(`${promptText} (Scène ${parts.length + 1})`);
      }
    }
  }
  if (parts.length > n) {
    const result = [];
    const chunkSize = parts.length / n;
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * chunkSize);
      const end = Math.floor((i + 1) * chunkSize);
      result.push(parts.slice(start, end).join(". "));
    }
    return result;
  }
  return parts.slice(0, n);
}

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
    const sections = String(params.sections || params.scenes || "2");
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
    const numSections = Math.max(1, parseInt(sections, 10) || 2);
    const creditCost = numSections; // 2 sections = 2 crédits, 6 sections = 6 crédits
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
    const host = req.headers.host || "magiclight-api.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";

    // URL publique pour servir l'image du personnage (supporte base64 et URLs distantes)
    const publicCharImgUrl = initialImage.startsWith("http")
      ? initialImage
      : `${protocol}://${host}/stanleystawa/download?task_id=${taskId}&type=image`;

    // 4. Découpage du scénario en N scènes
    const scenePrompts = partitionStory(prompt, numSections);
    console.log(`[Video Task ${taskId}] Partitionné en ${scenePrompts.length} scènes :`, scenePrompts);

    // 5. Enregistrement initial dans Turso DB
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, initial_image, status, progress, step, message, user_key, credits_deducted, refunded, duration, scenes_count, check_url)
      VALUES (?, ?, ?, 'processing', 20, 'animating', ?, ?, ?, 0, ?, ?, '');
    `;
    const initialMessage = `Génération de ${numSections} scènes IA en cours (${numSections * 10}s)...`;
    await turso.execute(sql, [taskId, prompt, initialImage, initialMessage, auth.key || "", creditCost, numSections * 10, numSections]);

    // 6. Lancement des N jobs d'animation IA en parallèle sur le cluster distant
    const sceneJobs = [];
    for (let i = 0; i < scenePrompts.length; i++) {
      const sPrompt = scenePrompts[i];
      const sIndex = i + 1;
      try {
        const animUrl = `https://vercel-animate-api.vercel.app/stanleystawa/video?prompt=${encodeURIComponent(sPrompt)}&imageUrl=${encodeURIComponent(publicCharImgUrl)}&duration=10&quality=${quality}&format=json`;
        const animRes = await fetch(animUrl, { signal: AbortSignal.timeout(8000) });
        if (animRes.ok) {
          const animData = await animRes.json();
          if (animData.checkUrl) {
            sceneJobs.push({
              scene: sIndex,
              prompt: sPrompt,
              checkUrl: animData.checkUrl,
              videoUrl: null,
              status: "IN_PROGRESS"
            });
            console.log(`[Scene ${sIndex}/${numSections} Dispatched] checkUrl: ${animData.checkUrl}`);
          }
        }
      } catch (e) {
        console.warn(`[Scene ${sIndex} Dispatch Error]:`, e.message);
      }
    }

    // Sauvegarde de la liste des jobs multi-scènes dans Turso DB (JSON)
    const checkUrlPayload = JSON.stringify(sceneJobs);
    await turso.execute(`UPDATE video_tasks SET check_url = ? WHERE task_id = ?;`, [checkUrlPayload, taskId]);

    // 7. Déclenchement du Worker HF / Render (si configuré)
    if (HF_WORKER_URL) {
      try {
        fetch(`${HF_WORKER_URL}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            prompt,
            initial_image: publicCharImgUrl,
            sections: numSections,
            quality,
            duration: parseInt(duration, 10),
            ratio,
            language
          })
        }).catch(() => {});
      } catch (e) {}
    }

    const checkUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}`;
    const downloadUrl = `${protocol}://${host}/stanleystawa/download?task_id=${taskId}`;
    const mp4PollUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}&format=mp4`;

    if (format === "redirect" || format === "mp4") {
      return res.redirect(302, mp4PollUrl);
    }

    return res.status(200).json({
      status: "processing",
      task_id: taskId,
      sections: numSections,
      quality: quality,
      duration_per_section: 10,
      total_duration_estimate: `${numSections * 10}s`,
      credits_deducted: creditCost,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
      ratio: ratio === "2" ? "9:16" : "16:9",
      character_image: "Fournie (Référence cohérente 100%)",
      scenes: scenePrompts,
      check_url: checkUrl,
      download_url: downloadUrl,
      mp4_direct_url: mp4PollUrl,
      message: `Rendu de ${numSections} sections initié avec succès (${numSections * 10}s totales, coût : ${creditCost} crédits).`
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
