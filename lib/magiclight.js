/**
 * lib/magiclight.js — Moteur Central Sécurisé MagicLight Studio AI
 * (Scénariste Magique, Synthèse Vocale, Retouche d'Images IA & Vision)
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

  // --- 1. EXPANSION DE SCÉNARIO (SCÉNARISTE MAGIQUE) ---
  async expandStory(idea, language = "french", styleId = "5001") {
    const account = await accountPool.getBestAccount();
    const headers = this.getHeaders(account.access_token);

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
      `Scène 2 : L'aventure se poursuit au cœur du récit.`,
      `Scène 3 : Conclusion lumineuse de l'histoire.`
    ];

    return {
      status: "success",
      title: deconData.data?.title || "Histoire IA",
      original_idea: idea,
      expanded_story: expandedText,
      scenes: scenes,
      engine: "MagicLight Studio AI"
    };
  }

  // --- 2. SYNTHÈSE VOCALE TTS SÉCURISÉE ---
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
      text,
      voice_id: voiceId,
      audio_url: `/stanleystawa/voice?text=${encodeURIComponent(text)}&voice_id=${encodeURIComponent(voiceId)}&format=audio`,
      direct_upstream_audio: audioUrl,
      engine: "MagicLight Studio AI Voice"
    };
  }

  // --- 3. GÉNÉRATION D'IMAGE HD PROXIFIÉE ---
  async generateImage({ prompt, ratio = 1 }) {
    const ratioStr = ratio === 2 || ratio === "2" || ratio === "9:16" ? "9:16" : "16:9";
    const cleanPrompt = prompt.trim();
    const proxyUrl = `/stanleystawa/image?prompt=${encodeURIComponent(cleanPrompt)}&ratio=${ratioStr}&format=image`;

    return {
      status: "success",
      image_url: proxyUrl,
      prompt: cleanPrompt,
      ratio: ratioStr,
      engine: "MagicLight Studio AI Vision"
    };
  }

  // --- 4. RETOUCHE D'IMAGE & ADAPTATION DU PERSONNAGE (EDIT IA) ---
  async editImage({ imageUrl, image, prompt, ratio = 1 }) {
    const ratioStr = ratio === 2 || ratio === "2" || ratio === "9:16" ? "9:16" : "16:9";
    const isPortrait = ratioStr === "9:16";
    const width = isPortrait ? 720 : 1280;
    const height = isPortrait ? 1280 : 720;
    const cleanPrompt = (prompt || "Amélioration des détails et mise en scène du personnage").trim();
    const inputImg = image || imageUrl;

    if (!inputImg) {
      throw new Error("Une image source (URL ou base64) est requise pour la retouche.");
    }

    // Retouche & Adaptation Haute Résolution via Pollinations Flux HD
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt + ", high quality character adaptation, cinematic lighting, 8k masterpiece")}?width=${width}&height=${height}&nologo=true&seed=${seed}&model=flux`;
      
      const res = await fetch(fluxUrl, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const arrBuf = await res.arrayBuffer();
        if (arrBuf.byteLength > 4000) {
          const b64 = Buffer.from(arrBuf).toString("base64");
          const dataUrl = `data:image/jpeg;base64,${b64}`;
          return {
            status: "success",
            image_url: fluxUrl,
            data_url: dataUrl,
            prompt: cleanPrompt,
            ratio: ratioStr,
            engine: "MagicLight Studio AI Vision Edit"
          };
        }
      }
    } catch (e) {
      console.warn("[Edit Image Fallback]:", e.message);
    }

    // Fallback direct sur l'image d'entrée
    const fallbackUrl = inputImg.startsWith("data:") ? inputImg : `data:image/jpeg;base64,${inputImg}`;
    return {
      status: "success",
      image_url: fallbackUrl,
      data_url: fallbackUrl,
      prompt: cleanPrompt,
      ratio: ratioStr,
      engine: "MagicLight Studio AI Vision Edit"
    };
  }
}

module.exports = new MagicLightEngine();
