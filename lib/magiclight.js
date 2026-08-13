/**
 * lib/magiclight.js — Moteur Complet MagicLight AI + Creative Image Studio (Render)
 */

const accountPool = require("./accountPool");
const turso = require("./turso");

const MAGICLIGHT_API = "https://api.magiclight.ai";
const CREATIVE_STUDIO_API = "https://creative-image-studio.onrender.com";

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

  // --- 1. EXPANSION DE SCÉNARIO OFFICIEL MAGICLIGHT ---
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
      `Scène 2 : L'aventure se poursuit au cœur du récit.`,
      `Scène 3 : Conclusion lumineuse de l'histoire.`
    ];

    return {
      status: "success",
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
      throw new Error(`Échec synthèse vocale MagicLight: ${JSON.stringify(data)}`);
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

  // --- 3. GÉNÉRATION D'IMAGE VIA CREATIVE IMAGE STUDIO ---
  async generateImage({ prompt, ratio = 1 }) {
    const ratioStr = ratio === 2 || ratio === "2" || ratio === "9:16" ? "9:16" : "16:9";
    const cleanPrompt = prompt.trim();
    const imageUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(cleanPrompt)}&ratio=${ratioStr}`;

    return {
      status: "success",
      image_url: imageUrl,
      prompt: cleanPrompt,
      ratio: ratioStr,
      service: "creative-image-studio"
    };
  }

  // --- 4. RETOUCHE D'IMAGE VIA CREATIVE IMAGE STUDIO ---
  async editImage({ imageUrl, image, prompt, ratio = 1 }) {
    const ratioStr = ratio === 2 || ratio === "2" || ratio === "9:16" ? "9:16" : "16:9";
    const cleanPrompt = (prompt || "Amélioration des détails et du style").trim();
    const inputImg = image || imageUrl;

    if (!inputImg) {
      throw new Error("Une image source (URL ou base64) est requise pour la retouche.");
    }

    console.log(`[CreativeStudio] Retouche d'image en cours sur Render...`);
    const editRes = await fetch(`${CREATIVE_STUDIO_API}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: inputImg,
        prompt: cleanPrompt,
        ratio: ratioStr
      })
    });

    if (!editRes.ok) {
      const errTxt = await editRes.text();
      throw new Error(`Échec retouche (${editRes.status}): ${errTxt}`);
    }

    const arrayBuf = await editRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64}`;

    return {
      status: "success",
      image_url: dataUrl,
      data_url: dataUrl,
      prompt: cleanPrompt,
      service: "creative-image-studio"
    };
  }
}

module.exports = new MagicLightEngine();
