/**
 * lib/magiclight.js — Moteur Central Sécurisé MagicLight Studio AI (Masquage 100% des Services Amont)
 */

const accountPool = require("./accountPool");

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

  // --- 1. EXPANSION DE SCÉNARIO ---
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

  // --- 4. RETOUCHE D'IMAGE ---
  async editImage({ imageUrl, image, prompt, ratio = 1 }) {
    const ratioStr = ratio === 2 || ratio === "2" || ratio === "9:16" ? "9:16" : "16:9";
    const cleanPrompt = (prompt || "Amélioration des détails et du style").trim();
    const inputImg = image || imageUrl;

    if (!inputImg) {
      throw new Error("Une image source (URL ou base64) est requise pour la retouche.");
    }

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
      ratio: ratioStr,
      engine: "MagicLight Studio AI Vision"
    };
  }
}

module.exports = new MagicLightEngine();
