/**
 * lib/magiclight.js — Moteur Cloud MagicLight AI Multi-Scènes & Watermark-Free
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

  // --- 2. INITIALISATION RAPIDE DE VIDÉO MULTI-SCÈNES ---
  async initVideoProject({
    prompt,
    text,
    title = "Vidéo MagicLight",
    mode = "expand",
    styleId = "5001",
    language = "french",
    ratio = 1
  }) {
    const triedEmails = [];
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const account = await accountPool.getBestAccount(triedEmails);
      const headers = this.getHeaders(account.access_token);

      let scriptText = text || prompt || "Un petit chaton joueur dans un jardin magique";
      let projectTitle = title;
      let sceneList = [scriptText];

      if (mode === "expand" || scriptText.length < 100) {
        try {
          const story = await this.expandStory(scriptText, language, styleId);
          scriptText = story.expanded_story;
          if (story.title) projectTitle = story.title;
          if (story.scenes && story.scenes.length >= 2) {
            sceneList = story.scenes;
          }
        } catch (e) {
          console.warn("[MagicLight] Fallback texte:", e.message);
        }
      }

      console.log(`[MagicLight] Création projet "${projectTitle}" sur ${account.email}...`);
      const projRes = await fetch(`${MAGICLIGHT_API}/api/project`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: projectTitle,
          fullText: sceneList[0] || scriptText,
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
          doneVlog: 1,
          directingStyle: "Auto"
        })
      });

      const projData = await projRes.json();

      if (projData.code === 8000 || projData.code === 401) {
        console.warn(`[MagicLight] Compte ${account.email} limité. Rotation...`);
        triedEmails.push(account.email);
        lastError = projData.msg;
        continue;
      }

      const projectId = projData.data?.id;
      const flowId = projData.data?.flowId;

      if (!projectId) {
        throw new Error(`Échec création projet vidéo: ${JSON.stringify(projData)}`);
      }

      // Si le scénario a une 2e scène, on l'insère dès que les chapitres sont prêts
      if (sceneList.length >= 2) {
        setTimeout(async () => {
          try {
            for (let k = 0; k < 5; k++) {
              await new Promise(r => setTimeout(r, 2000));
              const ed = await (await fetch(`${MAGICLIGHT_API}/api/project/editor/${projectId}`, { headers })).json();
              const chapterId = ed.data?.chapters?.[0]?.id;
              if (chapterId && (ed.data?.paragraphs?.length || 0) < 2) {
                await fetch(`${MAGICLIGHT_API}/api/paragraph/insert`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    projectId,
                    chapterId,
                    desc: sceneList[1],
                    sceneType: "Other",
                    tier: "free"
                  })
                });
                break;
              }
            }
          } catch (err) {}
        }, 1000);
      }

      return {
        status: "processing",
        step: "initializing",
        progress: 15,
        project_id: projectId,
        flow_id: flowId,
        account_email: account.email,
        title: projectTitle,
        message: "Projet multi-scènes créé avec succès. Rendu des images en cours..."
      };
    }

    throw new Error(`Impossible d'initialiser le projet: ${lastError}`);
  }

  // --- 3. STATE MACHINE PROGESSIVE DE SUIVI VIDÉO ET IMAGE ---
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
      const allAccs = await turso.getActiveAccounts();
      for (const altAcc of allAccs) {
        if (altAcc.email !== account.email) {
          const altEdRes = await fetch(`${MAGICLIGHT_API}/api/project/editor/${projectId}`, { headers: this.getHeaders(altAcc.access_token) });
          const altEd = await altEdRes.json();
          if (altEd.code === 200) {
            account = altAcc;
            ed.data = altEd.data;
            ed.code = 200;
            break;
          }
        }
      }
    }

    const project = ed.data?.project;
    const chapters = ed.data?.chapters || [];
    const chapterId = chapters[0]?.id;
    const flowId = project?.flowId;
    const paragraphs = ed.data?.paragraphs || [];
    const images = ed.data?.images || [];
    const coverUrl = project?.coverUrl || images[0]?.url || ed.data?.worldViews?.[0]?.demoUrl;

    // Étape 1 : Création chapitres
    if (!chapterId || project?.step === 1) {
      return {
        status: "processing",
        step: "parsing_script",
        progress: 25,
        project_id: projectId,
        cover_url: coverUrl,
        image_url: coverUrl,
        message: "Analyse du scénario et création des scènes..."
      };
    }

    // Étape 2 : Confirmation des crédits
    if (project?.isPay === 0) {
      console.log(`[Status] Validation billing pour projet ${projectId}...`);
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

      // Lance la génération d'image pour chaque paragraphe
      for (const p of paragraphs) {
        if (!p.selectedImgId) {
          fetch(`${MAGICLIGHT_API}/api/task/generation2`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              projectId,
              flowId,
              styleId: project.styleId,
              chapterId,
              isTemplate: 0,
              paraId: p.id,
              imageId: "",
              modelType: "magiclight",
              ratio: project.ratio,
              forceUsePayCredit: false,
              layoutId: ""
            })
          }).catch(() => {});
        }
      }

      return {
        status: "processing",
        step: "billing_confirmed",
        progress: 40,
        project_id: projectId,
        cover_url: coverUrl,
        image_url: coverUrl,
        message: "Paiement en crédits validé. Rendu des images de scènes..."
      };
    }

    // Étape 3 : Rendu vidéo cloud sans filigrane
    if (project?.step < 5) {
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
          progress: 70,
          project_id: projectId,
          cover_url: coverUrl,
          image_url: coverUrl,
          message: "Images prêtes. Composition vidéo multi-scènes en cours..."
        };
      } else {
        return {
          status: "processing",
          step: "generating_images",
          progress: 55,
          project_id: projectId,
          cover_url: coverUrl,
          image_url: coverUrl,
          message: "Rendu des images de chaque scène en cours..."
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
        cover_url: coverUrl,
        image_url: coverUrl,
        message: "Assemblage final de la vidéo, voix et musique..."
      };
    }

    // Étape 5 : Vidéo terminée (step 6)
    const vRes = await (await fetch(`${MAGICLIGHT_API}/api/video?chapterId=${chapterId}`, { headers })).json();
    if (vRes.data?.url) {
      await accountPool.deductCredits(account.email, 5);

      return {
        status: "success",
        step: "completed",
        progress: 100,
        video_url: vRes.data.url,
        cover_url: vRes.data.coverUrl || coverUrl,
        image_url: vRes.data.coverUrl || coverUrl,
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
      cover_url: coverUrl,
      image_url: coverUrl,
      message: "Finalisation du fichier vidéo MP4..."
    };
  }

  // --- 4. GÉNÉRATION D'IMAGE ---
  async generateImage({ prompt, styleId = "5001", ratio = 1 }) {
    const triedEmails = [];
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const account = await accountPool.getBestAccount(triedEmails);
      const headers = this.getHeaders(account.access_token);

      console.log(`[MagicLight] Création image pour "${prompt}" sur ${account.email}...`);
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
          version: "2",
          doneVlog: 1,
          directingStyle: "Auto"
        })
      });
      const projData = await projRes.json();

      if (projData.code === 8000 || projData.code === 401) {
        console.warn(`[MagicLight] Compte ${account.email} limité. Rotation...`);
        triedEmails.push(account.email);
        lastError = projData.msg;
        continue;
      }

      const projectId = projData.data?.id;
      if (!projectId) {
        throw new Error(`Échec création tâche image: ${JSON.stringify(projData)}`);
      }

      // Valide le billing pour déclencher le rendu de l'image
      setTimeout(() => {
        fetch(`${MAGICLIGHT_API}/api/project/billing-confirm`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            projectId,
            nextStage: "image",
            img2videoModel: "seedance2_0fast",
            fastMode: true
          })
        }).catch(() => {});
      }, 1500);

      return {
        status: "processing",
        project_id: projectId,
        account_used: account.email,
        message: "Image en cours de rendu par le moteur MagicLight AI."
      };
    }

    throw new Error(`Impossible de générer l'image: ${lastError}`);
  }

  // --- 5. RETOUCHE / ÉDITION D'IMAGE ---
  async editImage({ imageUrl, prompt, styleId = "5001" }) {
    const fullPrompt = prompt ? `Retouche stylisée: ${prompt}` : "Amélioration des détails";
    return this.generateImage({ prompt: fullPrompt, styleId });
  }

  // --- 6. SYNTHÈSE VOCALE / TTS ---
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
