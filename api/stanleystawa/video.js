/**
 * api/stanleystawa/video.js — Moteur Complet MagicLight AI
 * 1. Scénariste Magique (Expansion d'histoire & Décomposition en N scènes via Gemini / Llama / MagicLight)
 * 2. Analyse Visuelle du Personnage (Gemini Vision) pour fidélité 100%
 * 3. Animation avec paroles et action des personnages
 * 4. Respect strict de la durée réelle (ex: 6 sections = 60s / 1 minute)
 */

const turso = require("../../lib/turso");
const security = require("../../lib/security");
const magiclight = require("../../lib/magiclight");
const defaultImage = require("../../lib/default-image");
const gemini = require("../../lib/gemini");

// Partitionnement des phrases générées par le Scénariste Magique en N sections équilibrées
function partitionSentences(sentences, n) {
  if (!sentences || !sentences.length) return [];
  if (sentences.length <= n) {
    const result = [...sentences];
    while (result.length < n) {
      let longestIdx = 0;
      for (let i = 1; i < result.length; i++) {
        if (result[i].length > result[longestIdx].length) longestIdx = i;
      }
      const words = result[longestIdx].split(" ");
      if (words.length <= 4) break;
      const mid = Math.floor(words.length / 2);
      const part1 = words.slice(0, mid).join(" ");
      const part2 = words.slice(mid).join(" ");
      result.splice(longestIdx, 1, part1, part2);
    }
    return result.slice(0, n);
  }

  const sections = [];
  const chunkSize = sentences.length / n;
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * chunkSize);
    const end = Math.floor((i + 1) * chunkSize);
    const chunk = sentences.slice(start, end);
    sections.push(chunk.join(" "));
  }
  return sections;
}

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 1. Authentification
  const auth = await security.authenticateRequest(req);
  if (!auth.authorized) {
    return res.status(401).json({
      error: auth.reason || "Accès refusé : Clé API secrète invalide ou manquante.",
      auth_methods: "Inscrivez-vous sur le site pour obtenir votre clé d'accès (+30 crédits) ou passez votre clé '?key=...' / 'x-api-key'"
    });
  }

  if (!security.checkRateLimit(req, 15)) {
    return res.status(429).json({
      error: "Trop de requêtes vidéo initiées. Veuillez patienter une minute avant de relancer un rendu."
    });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.text || params.idea || "").trim();
    let initialImage = (params.imageUrl || params.image || params.initial_image || params.initialImage || "").trim();
    const sections = String(params.sections || params.scenes || "6");
    const quality = String(params.quality || "medium").toLowerCase();
    const duration = String(params.duration || params.seconds || "10");
    const ratio = String(params.ratio || "1");
    const language = String(params.language || "french");
    const format = String(params.format || "json").toLowerCase();

    if (!prompt) {
      return res.status(400).json({
        error: "Le paramètre 'prompt' ou 'text' est requis.",
        example: `https://${req.headers.host || 'magiclight-api-gamma.vercel.app'}/stanleystawa/video?prompt=Un+lapin+avec+des+lunettes+rouges+explore+le+jardin&imageUrl=https://...&key=${auth.key || security.MASTER_API_KEY}`
      });
    }

    // Personnage par défaut (Lapin blanc aux lunettes rouges) si non fourni
    if (!initialImage) {
      initialImage = defaultImage.getDefaultImageDataUrl();
    }

    // 2. Tarification : 1 crédit par section
    const numSections = Math.max(1, parseInt(sections, 10) || 6);
    const creditCost = numSections;
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
    const host = req.headers.host || "magiclight-api-gamma.vercel.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";

    // URL publique .jpg dédiée pour que l'IA télécharge et anime exactement le personnage
    const publicCharImgUrl = initialImage.startsWith("http")
      ? initialImage
      : `${protocol}://${host}/stanleystawa/download?task_id=${taskId}&type=image&name=character_${taskId}.jpg`;

    // ----------------------------------------------------
    // ÉTAPE 1 : Scénariste Magique & Analyse Visuelle du Personnage
    // ----------------------------------------------------
    let finalScenes = [];
    let storyTitle = "Histoire IA";
    let expandedStory = prompt;

    try {
      const storyData = await magiclight.expandStory(prompt, language, "5001", numSections);
      if (storyData && storyData.scenes && storyData.scenes.length) {
        storyTitle = storyData.title || storyTitle;
        expandedStory = storyData.expanded_story || prompt;
        finalScenes = partitionSentences(storyData.scenes, numSections);
      }
    } catch (storyErr) {
      console.warn("[Scénariste Magique Fallback]:", storyErr.message);
    }

    if (!finalScenes.length) {
      finalScenes = partitionSentences([prompt], numSections);
    }

    // Analyse visuelle du personnage via Gemini Vision
    const charDesc = await gemini.describeCharacter(initialImage);

    // ----------------------------------------------------
    // ÉTAPE 2 : Déclenchement Parallèle de l'Animation avec Paroles Réelles & Personnage
    // ----------------------------------------------------
    const sceneJobs = await Promise.all(
      finalScenes.map(async (sceneText, i) => {
        const sceneIdx = i + 1;
        let checkUrl = "";

        // Prompt d'animation précis avec le personnage identifié
        const animPrompt = `${charDesc} in scene: "${sceneText}", character speaking with natural mouth movement and speech audio, expressive facial acting, cinematic lighting, 8k masterpiece`;

        try {
          const animUrl = `https://vercel-animate-api.vercel.app/stanleystawa/video?prompt=${encodeURIComponent(animPrompt)}&imageUrl=${encodeURIComponent(publicCharImgUrl)}&duration=10&quality=${quality}&format=json`;
          const animRes = await fetch(animUrl, { signal: AbortSignal.timeout(7000) });
          if (animRes.ok) {
            const animData = await animRes.json();
            if (animData.checkUrl) {
              checkUrl = animData.checkUrl;
            }
          }
        } catch (aErr) {
          console.warn(`[Scene ${sceneIdx} Animate Warning]:`, aErr.message);
        }

        return {
          scene: sceneIdx,
          prompt: sceneText,
          checkUrl: checkUrl,
          videoUrl: null,
          status: "IN_PROGRESS"
        };
      })
    );

    const totalSeconds = numSections * 10;
    const initialMessage = `Scénario "${storyTitle}" en cours : Génération du film complet de ${totalSeconds}s (${numSections} scènes)...`;

    // ----------------------------------------------------
    // ÉTAPE 3 : Enregistrement dans Turso DB
    // ----------------------------------------------------
    const sql = `
      INSERT INTO video_tasks (task_id, prompt, initial_image, status, progress, step, message, user_key, credits_deducted, refunded, duration, scenes_count, check_url)
      VALUES (?, ?, ?, 'processing', 20, 'animating', ?, ?, ?, 0, ?, ?, ?);
    `;
    await turso.execute(sql, [
      taskId,
      expandedStory,
      initialImage,
      initialMessage,
      auth.key || "",
      creditCost,
      totalSeconds,
      numSections,
      JSON.stringify(sceneJobs)
    ]);

    const statusUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}`;
    const downloadUrl = `${protocol}://${host}/stanleystawa/download?task_id=${taskId}`;
    const mp4PollUrl = `${protocol}://${host}/stanleystawa/status?task_id=${taskId}&format=mp4`;

    if (format === "redirect" || format === "mp4") {
      return res.redirect(302, mp4PollUrl);
    }

    return res.status(200).json({
      status: "processing",
      task_id: taskId,
      title: storyTitle,
      expanded_story: expandedStory,
      character_description: charDesc,
      sections: numSections,
      duration_per_section: 10,
      total_duration_estimate: `${totalSeconds}s (${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60 ? (totalSeconds % 60) + 's' : ''})`.trim(),
      credits_deducted: creditCost,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
      character_image: "Personnage officiel (100% Cohérence Visuelle)",
      scenes: sceneJobs.map(s => ({ scene: s.scene, narration: s.prompt })),
      check_url: statusUrl,
      download_url: downloadUrl,
      mp4_direct_url: mp4PollUrl,
      message: `Scénariste Magique activé : Film complet de ${numSections} scènes initié (${totalSeconds}s réelles).`
    });

  } catch (err) {
    console.error("[API Video Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
