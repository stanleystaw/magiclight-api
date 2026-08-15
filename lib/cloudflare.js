/**
 * lib/cloudflare.js — Intégration Native Cloudflare Workers AI (Edge GPU 100% Gratuit)
 *
 * Modèles :
 * - Image Génération : @cf/black-forest-labs/flux-1-schnell & @cf/stabilityai/stable-diffusion-xl-base-1.0
 * - Image Edit (Vrai Neural Img2Img) : @cf/runwayml/stable-diffusion-v1-5-img2img
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

  // --- 2. VRAI RETOUCHE NEURONALE IMAGE-TO-IMAGE (@cf/runwayml/stable-diffusion-v1-5-img2img) ---
  async editImage({ imageBuffer, prompt, strength = 0.65, guidance = 7.5, num_steps = 20 }) {
    if (!this.isConfigured() || !imageBuffer) return null;

    const cleanPrompt = String(prompt || "").trim();
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`;
    
    try {
      const byteArray = Array.from(new Uint8Array(imageBuffer));
      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          prompt: cleanPrompt,
          negative_prompt: "blurry, low quality, bad anatomy, distorted, deformed, disfigured, watermark, text",
          image: byteArray,
          strength: parseFloat(strength) || 0.65,
          guidance: parseFloat(guidance) || 7.5,
          num_steps: parseInt(num_steps, 10) || 20
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("image") || contentType.includes("octet-stream")) {
          const arrBuf = await res.arrayBuffer();
          const outBuf = Buffer.from(arrBuf);
          if (outBuf.length > 2000) {
            return outBuf;
          }
        } else {
          const data = await res.json();
          if (data.result && data.result.image) {
            return Buffer.from(data.result.image, "base64");
          }
        }
      } else {
        const errText = await res.text();
        console.warn(`[Cloudflare img2img HTTP ${res.status}]:`, errText.slice(0, 200));
      }
    } catch (e) {
      console.warn("[Cloudflare img2img Error]:", e.message);
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
