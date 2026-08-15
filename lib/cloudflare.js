/**
 * lib/cloudflare.js — Intégration Native Cloudflare Workers AI (Edge GPU 100% Gratuit)
 *
 * Modèles supportés :
 * - Image : @cf/black-forest-labs/flux-1-schnell, @cf/stabilityai/stable-diffusion-xl-base-1.0
 * - Texte/Story : @cf/meta/llama-3.1-8b-instruct
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

  // --- 1. GÉNÉRATION D'IMAGE AVEC FLUX-1-SCHNELL (CLOUDFLARE WORKERS AI) ---
  async generateImage(prompt, { num_steps = 4 } = {}) {
    if (!this.isConfigured()) return null;

    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          prompt: String(prompt).trim(),
          num_steps: num_steps || 4,
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
      console.warn("[Cloudflare Image AI Warning]:", e.message);
    }
    return null;
  }

  // --- 2. EXPANSION DE SCÉNARIO AVEC LLAMA-3.1-8B (CLOUDFLARE WORKERS AI) ---
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
