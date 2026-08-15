/**
 * lib/gemini.js — Intégration Native Google AI Studio (Gemini 2.0 / 1.5 Flash & Imagen)
 * 100% Gratuit via Google AI Studio API Key
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY || process.env.GOOGLE_API_KEY || "";

class GoogleAIEngine {
  isConfigured() {
    return Boolean(GEMINI_API_KEY && GEMINI_API_KEY.trim().length > 10);
  }

  // --- 1. SCÉNARISTE MAGIQUE VIA GEMINI 2.0 / 1.5 FLASH (< 500ms) ---
  async expandStory(prompt, language = "french", nSections = 6) {
    if (!this.isConfigured()) return null;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const systemPrompt = `Tu es le meilleur scénariste de cinéma d'animation IA. 
Transforme l'idée de l'utilisateur en une histoire captivante découpée en exactement ${nSections} scènes vivantes et cohérentes en langue ${language}.
Chaque scène doit comporter des actions précises et des dialogues/paroles naturelles pour les personnages.

Réponds EXCLUSIVEMENT avec un objet JSON strict au format suivant :
{
  "title": "Titre du Film",
  "expanded_story": "Récit narratif complet de l'histoire...",
  "scenes": [
    "Scène 1 : Description détaillée avec action et paroles...",
    "Scène 2 : Suite avec action et paroles...",
    "Scène 3 : Suite...",
    "Scène 4 : Suite...",
    "Scène 5 : Suite...",
    "Scène 6 : Dénouement..."
  ]
}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\nIdée de l'histoire : ${prompt}` }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            responseMimeType: "application/json"
          }
        }),
        signal: AbortSignal.timeout(10000)
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
            engine: "Google AI Studio (Gemini Flash)"
          };
        }
      }
    } catch (e) {
      console.warn("[Google Gemini Story Error]:", e.message);
    }
    return null;
  }

  // --- 2. VISION & PROMPT ENHANCER POUR IMAGE / EDIT VIA GEMINI ---
  async enhanceImagePrompt(userPrompt, imageBase64 = null) {
    if (!this.isConfigured()) return userPrompt;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
      const parts = [
        {
          text: `En tant qu'expert en diffusion visuelle (Midjourney/Flux/SDXL), transforme ce prompt utilisateur en un prompt optimisé en anglais pour générer un chef-d'œuvre cinématographique 8K tout en préservant l'identité du personnage : "${userPrompt}". Réponds uniquement par le prompt amélioré en anglais (1 ou 2 phrases percutantes).`
        }
      ];

      if (imageBase64) {
        const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanB64
          }
        });
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 200 }
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const data = await res.json();
        const enhanced = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (enhanced && enhanced.length > 10) {
          return enhanced;
        }
      }
    } catch (e) {
      console.warn("[Gemini Enhance Prompt Note]:", e.message);
    }

    return userPrompt;
  }
}

module.exports = new GoogleAIEngine();
