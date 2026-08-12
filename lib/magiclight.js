/**
 * lib/magiclight.js — Moteur Cloud MagicLight AI (Mode Asynchrone Vercel + State Machine)
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

  // --- 1. EXPANSION DE SCÉNARIO ---
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

    return {
      original_idea: idea,
      expanded_story: expandedText,
      scenes: deconData.data?.sentences || [expandedText],
      title: deconData.data?.title || "Histoire IA"
    };
  }

  // --- 2. INITIALISATION RAPIDE DE PROJET VIDÉO (< 1s pour Vercel) ---
  async initVideoProject({
    prompt,
    text,
    title = "Vidéo MagicLight",
    mode = "expand",
    styleId = "5001",
    language = "french",
    ratio = 1
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

    console.log(`[MagicLight] Création projet "${projectTitle}" sur ${account.email}...`);
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
        vlogImage2VideoModel: "minimax_h3",
        bgmUrl: "https://cdn2-static.magiclight.ai/bgm/hologram-pulse.mp3",
        bgmVolume: 50,
        language,
        forceUsePayCredit: true,
        gptDuration: 1,
        version: "3",
        doneVlog: 1,
        directingStyle: "Auto"
      })
    });

    const projData = await projRes.json();
    const projectId = projData.data?.id;
    const flowId = projData.data?.flowId;

    if (!projectId) {
      throw new Error(`Échec création projet vidéo: ${JSON.stringify(projData)}`);
    }

    return {
      status: "processing",
      step: "initializing",
      progress: 15,
      project_id: projectId,
      flow_id: flowId,
      account_email: account.email,
      title: projectTitle,
      message: "Projet créé avec succès. Découpage du scénario et des scènes en cours..."
    };
  }

  // --- 3. STATE MACHINE PROGESSIVE (< 0.5s par appel pour Vercel) ---
  async checkAndUpdateVideoStatus(projectId, accountEmail) {
    let account = null;
    if (accountEmail) {
      const accounts = await turso.execute(`SELECT * FROM magiclight_accounts WHERE email = ?;`, [accountEmail]);
      account = accounts[0];
    }
    if (!account) {
      account = await accountPool.getBestAccount();
    }

    const headers = this.getHeaders(account.access_token);
    const edRes = await fetch(`${MAGICLIGHT_API}/api/project/editor/${projectId}`, { headers });
    const ed = await edRes.json();

    if (ed.code === 700 || ed.code === 401) {
      throw new Error("Accès non autorisé au projet.");
    }

    const project = ed.data?.project;
    const chapters = ed.data?.chapters || [];
    const chapterId = chapters[0]?.id;
    const flowId = project?.flowId;
    const images = ed.data?.images || [];

    // Étape 1 : En attente de création des chapitres
    if (!chapterId || project?.step === 1) {
      return {
        status: "processing",
        step: "parsing_script",
        progress: 25,
        project_id: projectId,
        message: "Analyse du scénario et création des chapitres..."
      };
    }

    // Étape 2 : Confirmation des crédits
    if (project?.isPay === 0) {
      console.log(`[Status] Confirmation billing pour projet ${projectId}...`);
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
      return {
        status: "processing",
        step: "billing_confirmed",
        progress: 40,
        project_id: projectId,
        message: "Paiement en crédits validé. Génération des images de scènes..."
      };
    }

    // Étape 3 : Déclenchement du rendu vidéo cloud (gen-video) dès que les images sont prêtes
    if (project?.step < 5) {
      console.log(`[Status] Déclenchement gen-video sans filigrane pour projet ${projectId}...`);
      const genRes = await (await fetch(`${MAGICLIGHT_API}/api/task/gen-video`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          chapterId,
          projectId,
          flowId,
          ratio: project.ratio || 1,
          noCaption: false,
          noWatermark: true,
          language: project.language || "french",
          coverText: project.name || "Vidéo MagicLight",
          definition: "720"
        })
      })).json();

      if (genRes.code === 200) {
        return {
          status: "processing",
          step: "rendering_video",
          progress: 75,
          project_id: projectId,
          message: "Images prêtes. Rendu vidéo cloud en cours sur MagicLight..."
        };
      } else {
        return {
          status: "processing",
          step: "generating_images",
          progress: 55,
          project_id: projectId,
          message: "Génération des images de chaque scène en cours..."
        };
      }
    }

    // Étape 4 : Rendu en cours
    if (project?.step === 5 || project?.step === 9) {
      return {
        status: "processing",
        step: "rendering_video",
        progress: 85,
        project_id: projectId,
        message: "Assemblage final de la vidéo, voix et musique..."
      };
    }

    // Étape 5 : Vidéo terminée (step 6)
    const vRes = await (await fetch(`${MAGICLIGHT_API}/api/video?chapterId=${chapterId}`, { headers })).json();
    if (vRes.data?.url) {
      // Déduction crédits Turso
      await accountPool.deductCredits(account.email, 5);

      return {
        status: "success",
        step: "completed",
        progress: 100,
        video_url: vRes.data.url,
        cover_url: vRes.data.coverUrl,
        duration: vRes.data.duration,
        resolution: `${vRes.data.width}x${vRes.data.height}`,
        no_watermark: vRes.data.noWatermark,
        account_used: account.email,
        project_id: projectId
      };
    }

    return {
      status: "processing",
      step: "rendering_video",
      progress: 90,
      project_id: projectId,
      message: "Finalisation du fichier vidéo..."
    };
  }

  // --- 4. GÉNÉRATION D'IMAGE ---
  async generateImage({ prompt, styleId = "5001", ratio = 1 }) {
    const account = await accountPool.getBestAccount();
    const headers = this.getHeaders(account.access_token);

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

    while (Date.now() - startTime < 12000) {
      await new Promise(r => setTimeout(r, 2000));
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
      return {
        status: "processing",
        project_id: projectId,
        account_used: account.email,
        message: "L'image est en cours de rendu. Vous pouvez réinterroger avec le projectId."
      };
    }

    await accountPool.deductCredits(account.email, 2);

    return {
      status: "success",
      image_url: imageUrl,
      prompt,
      account_used: account.email
    };
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
