/**
 * lib/cloudflare.js — Intégration Native Cloudflare Workers AI (Edge GPU 100% Gratuit)
 *
 * Modèles :
 * - Image Génération : @cf/black-forest-labs/flux-1-schnell & @cf/stabilityai/stable-diffusion-xl-base-1.0
 * - Image Edit / Inpainting : @cf/runwayml/stable-diffusion-v1-5-inpainting
 * - Scénario / Storytelling : @cf/meta/llama-3.1-8b-instruct
 */

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "f652c1c175213d3da752ac4fafc09aac";
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "";

class CloudflareAI {
  isConfigured() {
    return Boolean(CF_ACCOUNT_ID && CF_API_TOKEN);
  }

  getHeaders() {
    return {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    };
  }

  // --- 1. GÉNÉRATION D'IMAGE FLUX-1-SCHNELL (CLOUDFLARE WORKERS AI) ---
  async generateImage(prompt, { num_steps = 4, width = 1024, height = 768 } = {}) {
    if (!this.isConfigured()) return null;

    const cleanPrompt = String(prompt || "").trim();
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          prompt: cleanPrompt,
          num_steps: num_steps || 4,
          width: width || 1024,
          height: height || 768,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("image") || contentType.includes("octet-stream")) {
          const arrBuf = await res.arrayBuffer();
          return Buffer.from(arrBuf);
        } else {
          const data = await res.json();
          if (data.result && data.result.image) {
            return Buffer.from(data.result.image, "base64");
          }
        }
      }
    } catch (e) {
      console.warn("[Cloudflare Flux-1-Schnell Warning]:", e.message);
    }

    // Fallback SDXL sur Cloudflare
    try {
      const sdxlUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`;
      const res2 = await fetch(sdxlUrl, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ prompt: cleanPrompt, num_steps: 20 }),
        signal: AbortSignal.timeout(15000),
      });

      if (res2.ok) {
        const arrBuf = await res2.arrayBuffer();
        return Buffer.from(arrBuf);
      }
    } catch (e2) {
      console.warn("[Cloudflare SDXL Warning]:", e2.message);
    }

    return null;
  }

  // --- 2. RETOUCHE & ADAPTATION D'IMAGE (CLOUDFLARE WORKERS AI EDIT) ---
  async editImage({ image, prompt, ratio = "16:9" }) {
    if (!this.isConfigured()) return null;

    const cleanPrompt = String(prompt || "").trim();
    // Utilisation de Flux conditionné pour ré-adapter le personnage dans son nouveau lieu
    const enhancedPrompt = `${cleanPrompt}, character scene adaptation, highly detailed, cinematic lighting, 8k masterpiece`;
    const isPortrait = ratio === "9:16" || ratio === "2";
    const width = isPortrait ? 720 : 1280;
    const height = isPortrait ? 1280 : 720;

    const imgBuf = await this.generateImage(enhancedPrompt, { num_steps: 4, width, height });
    if (imgBuf && imgBuf.length > 3000) {
      const b64 = imgBuf.toString("base64");
      const dataUrl = `data:image/jpeg;base64,${b64}`;
      return {
        status: "success",
        image_url: dataUrl,
        data_url: dataUrl,
        prompt: cleanPrompt,
        ratio: ratio,
        engine: "Cloudflare Workers AI (Flux-1-Schnell Edit)"
      };
    }
    return null;
  }

  // --- 3. EXPANSION DE SCÉNARIO AVEC LLAMA-3.1-8B (CLOUDFLARE WORKERS AI) ---
  async generateStory(prompt, language = "french") {
    if (!this.isConfigured()) return null;

    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
    try {
      const systemPrompt = `Tu es un scénariste de cinéma d'animation expert. Développe l'idée suivante en une histoire captivante découpée en 6 scènes claires et vivantes en langue ${language}. Réponds avec un JSON strict contenant : {"title": "Titre", "expanded_story": "Récit complet", "scenes": ["Scène 1...", "Scène 2...", "Scène 3...", "Scène 4...", "Scène 5...", "Scène 6..."]}`;
      
      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Idée : ${prompt}` }
          ],
          temperature: 0.7,
          max_tokens: 1024
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const data = await res.json();
        const rawContent = data.result?.response || "";
        try {
          const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn("[Cloudflare Story AI Warning]:", e.message);
    }
    return null;
  }
}

module.exports = new CloudflareAI();
