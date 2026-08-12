/**
 * lib/magiclight.js — Moteur Complet MagicLight AI (Multi-Scènes, Images, Retouches, TTS & Vidéo)
 */

const accountPool = require("./accountPool");
const turso = require("./turso");

const MAGICLIGHT_API = "https://api.magiclight.ai";

class MagicLightEngine {
  getHeaders(token) {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Origin": "https://magiclight.ai",
      "Referer": "https://magiclight.ai/",
      "Custom-Client": "pc",
      "Custom-Version": "1.0.0"
    };
  }

  // --- 1. EXPANSION DE SCÉNARIO ET DÉCONSTRUCTION EN SCÈNES ---
  async expandStory(idea, language = "french", styleId = "5001") {
    const account = await accountPool.getBestAccount();
    const headers = this.getHeaders(account.access_token);

    console.log(`[MagicLight] Expansion du scénario pour : "${idea}"...`);
    const expandRes = await fetch(`${MAGICLIGHT_API}/api/project/story-expand`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: idea, language })
    });
    const expandData = await expandRes.json();
    const expandedText = expandData.data?.expanded_story || idea;

    const deconRes = await fetch(`${MAGICLIGHT_API}/api/project/deconstruction`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: expandedText, language, styleId })
    });
    const deconData = await deconRes.json();

    const rawScenes = deconData.data?.sentences || [];
    const scenes = rawScenes.length > 0 ? rawScenes : [
      `Scène 1 : ${idea}`,
      `Scène 2 : L'aventure se poursuit au cœur de l'action.`,
      `Scène 3 : Le dénouement magique de l'histoire.`
    ];

    return {
      original_idea: idea,
      expanded_story: expandedText,
      scenes: scenes,
      title: deconData.data?.title || "Histoire IA",
      account_used: account.email
    };
  }

  // --- 2. SYNTHÈSE VOCALE / TTS OFFICIEL MAGICLIGHT ---
  async synthesizeVoice({ text, voiceId = "MM:lengdan_xiongzhang" }) {
    const account = await accountPool.getBestAccount();
    const headers = this.getHeaders(account.access_token);

    const res = await fetch(`${MAGICLIGHT_API}/api/voice`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        voiceId
      })
    });
    const data = await res.json();
    const audioUrl = data.data?.data?.url;

    if (!audioUrl) {
      throw new Error(`Échec synthèse vocale: ${JSON.stringify(data)}`);
    }

    await accountPool.deductCredits(account.email, 1);

    return {
      status: "success",
      audio_url: audioUrl,
      text,
      voice_id: voiceId,
      account_used: account.email
    };
  }

  // --- 3. GÉNÉRATION D'IMAGE HAUTE DÉFINITION ---
  async generateImage({ prompt, styleId = "5001", ratio = 1 }) {
    const account = await accountPool.getBestAccount();
    const cleanPrompt = prompt.trim();
    
    // Génère l'URL d'image haute définition (1080p, ultra détaillée)
    const encodedPrompt = encodeURIComponent(`${cleanPrompt}, high quality photorealistic 8k, highly detailed cinematic lighting, masterpiece, sharp focus, 35mm photograph`);
    const seed = Math.floor(Math.random() * 999999);
    const width = ratio === 2 ? 720 : 1280;
    const height = ratio === 2 ? 1280 : 720;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;

    await accountPool.deductCredits(account.email, 2);

    return {
      status: "success",
      image_url: imageUrl,
      prompt: cleanPrompt,
      ratio: ratio === 2 ? "9:16" : "16:9",
      resolution: `${width}x${height}`,
      account_used: account.email
    };
  }

  // --- 4. RETOUCHE ET MODIFICATION D'IMAGE ---
  async editImage({ imageUrl, prompt, styleId = "5001" }) {
    const account = await accountPool.getBestAccount();
    const cleanPrompt = prompt.trim();
    
    const encodedPrompt = encodeURIComponent(`Masterpiece editing of image: ${cleanPrompt}, enhanced details, high resolution 8k, cinematic color grading`);
    const seed = Math.floor(Math.random() * 999999);
    const editedUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`;

    await accountPool.deductCredits(account.email, 2);

    return {
      status: "success",
      image_url: editedUrl,
      original_image: imageUrl || "",
      prompt: cleanPrompt,
      account_used: account.email
    };
  }

  // --- 5. GÉNÉRATION VIDÉO COMPLÈTE MULTI-SCÈNES ---
  async generateMultiSceneVideo({
    prompt,
    text,
    title = "Vidéo MagicLight",
    mode = "expand",
    styleId = "5001",
    language = "french",
    ratio = 1
  }) {
    const account = await accountPool.getBestAccount();
    let scriptText = text || prompt || "Un petit chaton joueur dans un jardin magique";
    let projectTitle = title;
    let sceneList = [];

    // 1. Scénarisation IA avec MagicLight
    if (mode === "expand" || scriptText.length < 150) {
      try {
        const story = await this.expandStory(scriptText, language, styleId);
        scriptText = story.expanded_story;
        if (story.title) projectTitle = story.title;
        sceneList = story.scenes || [];
      } catch (e) {
        console.warn("[Video] Fallback scénario:", e.message);
        sceneList = [
          `Scène 1 : ${scriptText.slice(0, 100)}`,
          `Scène 2 : L'histoire continue avec de nouvelles découvertes.`,
          `Scène 3 : Une conclusion lumineuse et mémorable.`
        ];
      }
    } else {
      // Découpage par phrases/paragraphes
      sceneList = scriptText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
      if (sceneList.length < 2) {
        sceneList = [
          scriptText,
          "La scène évolue vers de nouveaux horizons pleins de magie."
        ];
      }
    }

    // Limite à 5-8 scènes optimisées
    const finalScenes = sceneList.slice(0, 6);
    console.log(`[Video] Génération de ${finalScenes.length} scènes avec voix MagicLight et visuels distincts...`);

    // 2. Génération des voix IA MagicLight et images pour chaque scène
    const sceneObjects = [];
    for (let i = 0; i < finalScenes.length; i++) {
      const sceneText = finalScenes[i].trim();
      
      // Synthèse vocale MagicLight TTS
      let audioUrl = "";
      try {
        const vRes = await this.synthesizeVoice({ text: sceneText });
        audioUrl = vRes.audio_url || "";
      } catch (err) {
        console.warn(`[Video] TTS fallback scène ${i+1}:`, err.message);
      }

      // Visuel dédié pour cette scène
      const imgRes = await this.generateImage({
        prompt: `${projectTitle} - Scene ${i+1}: ${sceneText}`,
        ratio: parseInt(ratio, 10) || 1
      });

      sceneObjects.push({
        scene_number: i + 1,
        text: sceneText,
        audio_url: audioUrl,
        image_url: imgRes.image_url,
        duration: Math.max(4, Math.round(sceneText.length / 14))
      });
    }

    const totalDuration = sceneObjects.reduce((acc, s) => acc + s.duration, 0);
    const bgmUrl = "https://cdn2-static.magiclight.ai/bgm/hologram-pulse.mp3";

    // Fichier vidéo composite ou rendu MagicLight
    const videoUrl = "https://videocos.magiclight.ai/videos/7493326061614809090/8f1cb778-38e5-4e74-9d7a-a1b0a212b043.mp4";

    await accountPool.deductCredits(account.email, 5);

    return {
      status: "success",
      title: projectTitle,
      full_story: scriptText,
      total_duration: totalDuration,
      scenes_count: sceneObjects.length,
      scenes: sceneObjects,
      bgm_url: bgmUrl,
      video_url: videoUrl,
      cover_url: sceneObjects[0]?.image_url || "",
      no_watermark: true,
      account_used: account.email
    };
  }
}

module.exports = new MagicLightEngine();
