/**
 * lib/gemini.js — Intégration Native Google AI Studio (Gemini 2.0 / Flash-Lite / Imagen 3)
 * Modèle Prioritaire : gemini-2.0-flash-lite / gemini-1.5-flash-8b / imagen-3.0
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY || process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

class GoogleAIEngine {
  isConfigured() {
    return Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim().length > 10);
  }

  // --- 1. SCÉNARISTE MAGIQUE VIA GEMINI FLASH-LITE (< 400ms) ---
  async expandStory(prompt, language = "french", nSections = 6) {
    if (!this.isConfigured()) return null;

    const models = [GEMINI_MODEL, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];
    
    const systemPrompt = `Tu es le meilleur scénariste de cinéma d'animation IA. 
Transforme l'idée suivante en une histoire découpée en exactement ${nSections} scènes en langue ${language}.
Format JSON strict obligatoire :
{
  "title": "Titre",
  "expanded_story": "Récit complet...",
  "scenes": ["Scène 1...", "Scène 2...", "Scène 3...", "Scène 4...", "Scène 5...", "Scène 6..."]
}`;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: `${systemPrompt}\n\nIdée : ${prompt}` }]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
              responseMimeType: "application/json"
            }
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
          const data = await res.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const parsed = JSON.parse(rawText);
          if (parsed.scenes && Array.isArray(parsed.scenes)) {
            return {
              status: "success",
              title: parsed.title || "Film IA Gemini",
              original_idea: prompt,
              expanded_story: parsed.expanded_story || prompt,
              scenes: parsed.scenes,
              engine: `Google AI Studio (${model})`
            };
          }
        }
      } catch (e) {
        console.warn(`[Gemini ${model} Warning]:`, e.message);
      }
    }
    return null;
  }

  // --- 2. ANALYSE VISUELLE DU PERSONNAGE (GEMINI FLASH-LITE VISION) ---
  async describeCharacter(imageBase64) {
    if (!this.isConfigured() || !imageBase64) return "The main character";

    let cleanB64 = imageBase64;
    if (cleanB64.startsWith("data:image")) {
      cleanB64 = cleanB64.split(";base64,")[1];
    }

    const models = [GEMINI_MODEL, "gemini-2.0-flash", "gemini-1.5-flash"];

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: "Describe the character in this image concisely in English (e.g. 'A cute white bunny wearing red sunglasses'). Output ONLY the concise description."
                  },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: cleanB64
                    }
                  }
                ]
              }
            ],
            generationConfig: { temperature: 0.2, maxOutputTokens: 60 }
          }),
          signal: AbortSignal.timeout(6000)
        });

        if (res.ok) {
          const data = await res.json();
          const desc = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (desc && desc.length > 3) {
            return desc;
          }
        }
      } catch (e) {
        console.warn(`[Gemini Vision ${model} Note]:`, e.message);
      }
    }
    return "The main character";
  }

  // --- 3. GÉNÉRATION DIRECTE IMAGEN 3 (GOOGLE AI) ---
  async generateImagen(prompt, { aspectRatio = "16:9" } = {}) {
    if (!this.isConfigured()) return null;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_API_KEY}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: String(prompt).trim() }],
          parameters: {
            sampleCount: 1,
            aspectRatio: aspectRatio === "9:16" ? "9:16" : (aspectRatio === "1:1" ? "1:1" : "16:9"),
            outputOptions: { mimeType: "image/jpeg" }
          }
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (res.ok) {
        const data = await res.json();
        const b64 = data.predictions?.[0]?.bytesBase64Encoded;
        if (b64) {
          return Buffer.from(b64, "base64");
        }
      }
    } catch (e) {
      console.warn("[Google Imagen 3 Warning]:", e.message);
    }
    return null;
  }
}

module.exports = new GoogleAIEngine();
