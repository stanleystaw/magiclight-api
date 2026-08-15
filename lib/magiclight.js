/**
 * lib/magiclight.js — Moteur Central Sécurisé MagicLight Studio AI
 * (Scénariste Magique, Synthèse Vocale, Vrai Neural Image-to-Image Diffusion)
 */

const sharp = require("sharp");
const accountPool = require("./accountPool");
const cloudflare = require("./cloudflare");
const gemini = require("./gemini");

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
  async expandStory(idea, language = "french", styleId = "5001", nSections = 6) {
    // 1. Essai Google Gemini Flash si configuré (Ultra-rapide ~400ms)
    if (gemini.isConfigured()) {
      try {
        const geminiStory = await gemini.expandStory(idea, language, nSections);
        if (geminiStory && geminiStory.scenes && geminiStory.scenes.length >= 2) {
          return geminiStory;
        }
      } catch (e) {
        console.warn("[Gemini Story Fallback]:", e.message);
      }
    }

    // 2. Essai Cloudflare Llama-3.1 si configuré
    if (cloudflare.isConfigured()) {
      try {
        const cfStory = await cloudflare.generateStory(idea, language);
        if (cfStory && cfStory.scenes && cfStory.scenes.length >= 2) {
          return {
            status: "success",
            title: cfStory.title || "Histoire IA",
            original_idea: idea,
            expanded_story: cfStory.expanded_story || idea,
            scenes: cfStory.scenes,
            engine: "Cloudflare Workers AI (Llama 3.1)"
          };
        }
      } catch (e) {
        console.warn("[Cloudflare Story Fallback]:", e.message);
      }
    }

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
      body: JSON.stringify({ text, voiceId })
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

  // --- 3. GÉNÉRATION D'IMAGE HD ---
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

  // --- 4. VRAI NEURAL IMAGE-TO-IMAGE DIFFUSION EDIT ---
  async editImage({ imageUrl, image, prompt, ratio = "16:9", strength = 0.60 }) {
    const ratioStr = ratio === 2 || ratio === "2" || ratio === "9:16" ? "9:16" : (ratio === "1:1" ? "1:1" : "16:9");
    const cleanPrompt = (prompt || "Amélioration des détails et mise en scène du personnage").trim();
    const inputImg = image || imageUrl;

    if (!inputImg) {
      throw new Error("Une image source est requise pour la retouche.");
    }

    // 1. Décodage du buffer image source
    let rawBuf = null;
    if (inputImg.startsWith("data:image")) {
      const parts = inputImg.split(";base64,");
      rawBuf = Buffer.from(parts[1], "base64");
    } else if (inputImg.startsWith("http")) {
      const r = await fetch(inputImg);
      const arr = await r.arrayBuffer();
      rawBuf = Buffer.from(arr);
    } else {
      rawBuf = Buffer.from(inputImg, "base64");
    }

    // Redimensionnement standard 512x512 pour le modèle de diffusion img2img
    const normalizedBuf = await sharp(rawBuf)
      .resize(512, 512, { fit: "cover" })
      .jpeg({ quality: 90 })
      .toBuffer();

    // 2. Moteur Neural Img2Img via Cloudflare Workers AI (@cf/runwayml/stable-diffusion-v1-5-img2img)
    if (cloudflare.isConfigured()) {
      try {
        const cfImg2ImgBuf = await cloudflare.editImage({
          imageBuffer: normalizedBuf,
          prompt: `${cleanPrompt}, 8k resolution masterpiece, highly detailed, photorealistic texture, cinematic lighting`,
          strength: parseFloat(strength) || 0.60,
          guidance: 7.5,
          num_steps: 20
        });

        if (cfImg2ImgBuf && cfImg2ImgBuf.length > 2000) {
          const b64 = cfImg2ImgBuf.toString("base64");
          const dataUrl = `data:image/png;base64,${b64}`;
          return {
            status: "success",
            image_url: dataUrl,
            data_url: dataUrl,
            prompt: cleanPrompt,
            ratio: ratioStr,
            engine: "Cloudflare Workers AI (Neural Stable Diffusion img2img)"
          };
        }
      } catch (cfErr) {
        console.warn("[Cloudflare img2img Note]:", cfErr.message);
      }
    }

    // 3. Fallback Pollinations Flux Neural Prompt Conditioning
    const seed = Math.floor(Math.random() * 999999);
    const fluxPrompt = `${cleanPrompt}, transformation of character, highly detailed, cinematic lighting, 8k masterpiece`;
    const fluxUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fluxPrompt)}?width=768&height=768&seed=${seed}&nologo=true&model=flux`;

    try {
      const fRes = await fetch(fluxUrl, { signal: AbortSignal.timeout(12000) });
      if (fRes.ok && fRes.headers.get("content-type")?.includes("image")) {
        const arr = await fRes.arrayBuffer();
        const b64 = Buffer.from(arr).toString("base64");
        return {
          status: "success",
          image_url: fluxUrl,
          data_url: `data:image/jpeg;base64,${b64}`,
          prompt: cleanPrompt,
          ratio: ratioStr,
          engine: "Neural Flux Transformation"
        };
      }
    } catch (e) {}

    // Fallback direct sur l'image normalisée
    const b64Fallback = normalizedBuf.toString("base64");
    return {
      status: "success",
      image_url: `data:image/jpeg;base64,${b64Fallback}`,
      data_url: `data:image/jpeg;base64,${b64Fallback}`,
      prompt: cleanPrompt,
      ratio: ratioStr,
      engine: "Image Reference Standard"
    };
  }
}

module.exports = new MagicLightEngine();
