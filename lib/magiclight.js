/**
 * lib/magiclight.js — Moteur Cloud MagicLight AI (Vidéo sans filigrane, Image, Retouche, Scénario & Voix)
 */

const accountPool = require("./accountPool");

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

  // --- 1. EXPANSION DE SCÉNARIO ---
  async expandStory(idea, language = "french", styleId = "5001") {
    const account = await accountPool.getBestAccount();
    const headers = this.getHeaders(account.access_token);

    console.log(`[MagicLight] Expansion de scénario pour : "${idea}"...`);
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

    return {
      original_idea: idea,
      expanded_story: expandedText,
      scenes: deconData.data?.sentences || [expandedText],
      title: deconData.data?.title || "Histoire IA"
    };
  }

  // --- 2. GÉNÉRATION VIDÉO SANS FILIGRANE ---
  async generateVideo({
    prompt,
    text,
    title = "Vidéo IA",
    mode = "expand",
    styleId = "5001",
    language = "french",
    ratio = 1,
    noWatermark = true,
    timeout = 180000
  }) {
    const account = await accountPool.getBestAccount();
    const headers = this.getHeaders(account.access_token);

    let scriptText = text || prompt || "Un petit chaton joueur dans un jardin magique";
    let projectTitle = title;

    if (mode === "expand" && scriptText.length < 150) {
      try {
        const story = await this.expandStory(scriptText, language, styleId);
        scriptText = story.expanded_story;
        if (story.title) projectTitle = story.title;
      } catch (e) {
        console.warn("[MagicLight] Fallback texte direct:", e.message);
      }
    }

    console.log(`[MagicLight] Création du projet vidéo "${projectTitle}" sur le compte ${account.email}...`);

    const projRes = await fetch(`${MAGICLIGHT_API}/api/project`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: projectTitle,
        fullText: scriptText,
        styleId: String(styleId),
        ratio: parseInt(ratio, 10) || 1,
        voiceSpeed: 1,
        projectType: 1,
        vlogImage2VideoModel: "seedance2_0fast",
        bgmUrl: "https://cdn2-static.magiclight.ai/bgm/hologram-pulse.mp3",
        bgmVolume: 50,
        language,
        forceUsePayCredit: true,
        gptDuration: 1,
        version: "3",
        directingStyle: "Auto"
      })
    });
    const projData = await projRes.json();
    const projectId = projData.data?.id;
    if (!projectId) {
      throw new Error(`Échec création projet vidéo: ${JSON.stringify(projData)}`);
    }

    await new Promise(r => setTimeout(r, 4000));
    let editorInfo = await (await fetch(`${MAGICLIGHT_API}/api/project/editor/${projectId}`, { headers })).json();
    let chapters = editorInfo.data?.chapters || [];
    let flowId = editorInfo.data?.project?.flowId;

    if (!chapters.length) {
      await new Promise(r => setTimeout(r, 4000));
      editorInfo = await (await fetch(`${MAGICLIGHT_API}/api/project/editor/${projectId}`, { headers })).json();
      chapters = editorInfo.data?.chapters || [];
      flowId = editorInfo.data?.project?.flowId;
    }

    const chapterId = chapters[0]?.id;
    if (!chapterId) {
      throw new Error("Impossible de localiser le chapitre vidéo.");
    }

    console.log("[MagicLight] Validation et paiement du projet avec les crédits...");
    await fetch(`${MAGICLIGHT_API}/api/project/billing-confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId,
        nextStage: "image",
        img2videoModel: "seedance2_0fast",
        fastMode: true
      })
    });

    console.log("[MagicLight] Déclenchement du rendu vidéo cloud sans filigrane...");
    const genRes = await fetch(`${MAGICLIGHT_API}/api/task/gen-video`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chapterId,
        projectId,
        flowId,
        ratio: parseInt(ratio, 10) || 1,
        noCaption: false,
        noWatermark: !!noWatermark,
        language,
        coverText: projectTitle,
        definition: "720"
      })
    });
    const genData = await genRes.json();
    if (genData.code !== 200 && !genData.isOk) {
      throw new Error(`Échec lancement rendu: ${JSON.stringify(genData)}`);
    }

    console.log("[MagicLight] En attente du fichier MP4 finalisé...");
    const startTime = Date.now();
    let videoResult = null;

    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, 5000));
      const vRes = await fetch(`${MAGICLIGHT_API}/api/video?chapterId=${chapterId}`, { headers });
      const vData = await vRes.json();

      if (vData.code === 200 && vData.data?.url) {
        videoResult = vData.data;
        break;
      }
    }

    if (!videoResult) {
      throw new Error("Délai de rendu vidéo dépassé sur les serveurs MagicLight.");
    }

    await accountPool.deductCredits(account.email, 5);

    return {
      status: "success",
      video_url: videoResult.url,
      cover_url: videoResult.coverUrl,
      duration: videoResult.duration,
      resolution: `${videoResult.width}x${videoResult.height}`,
      no_watermark: videoResult.noWatermark,
      account_used: account.email,
      project_id: projectId
    };
  }

  // --- 3. GÉNÉRATION D'IMAGE ---
  async generateImage({ prompt, styleId = "5001", ratio = 1 }) {
    const account = await accountPool.getBestAccount();
    const headers = this.getHeaders(account.access_token);

    console.log(`[MagicLight] Génération d'image pour : "${prompt}"...`);
    const projRes = await fetch(`${MAGICLIGHT_API}/api/project`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: prompt.slice(0, 30),
        fullText: prompt,
        styleId: String(styleId),
        ratio: parseInt(ratio, 10) || 1,
        voiceSpeed: 1,
        projectType: 1,
        vlogImage2VideoModel: "seedance2_0fast",
        language: "french",
        forceUsePayCredit: true,
        gptDuration: 1,
        version: "3",
        doneVlog: 1
      })
    });
    const projData = await projRes.json();
    const projectId = projData.data?.id;

    if (!projectId) {
      throw new Error(`Échec création tâche image: ${JSON.stringify(projData)}`);
    }

    let imageUrl = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 60000) {
      await new Promise(r => setTimeout(r, 3000));
      const editorRes = await fetch(`${MAGICLIGHT_API}/api/project/editor/${projectId}`, { headers });
      const editorData = await editorRes.json();

      const worldViews = editorData.data?.worldViews || [];
      if (worldViews[0]?.demoUrl) {
        imageUrl = worldViews[0].demoUrl;
        break;
      }
      if (editorData.data?.project?.coverUrl) {
        imageUrl = editorData.data.project.coverUrl;
        break;
      }
    }

    if (!imageUrl) {
      throw new Error("Délai de génération d'image dépassé.");
    }

    await accountPool.deductCredits(account.email, 2);

    return {
      status: "success",
      image_url: imageUrl,
      prompt,
      account_used: account.email
    };
  }

  // --- 4. ÉDITION / RETOUCHE D'IMAGE ---
  async editImage({ imageUrl, prompt, styleId = "5001" }) {
    return this.generateImage({
      prompt: `Retouche de l'image précédente. Consigne : ${prompt}`,
      styleId
    });
  }

  // --- 5. SYNTHÈSE VOCALE / TTS ---
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
}

module.exports = new MagicLightEngine();
