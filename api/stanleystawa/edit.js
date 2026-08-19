/**
 * api/stanleystawa/edit.js — Moteur de Retouche IA Professionnel
 *
 * Pipeline :
 * 1. Lovable AI Gateway (https://ai.gateway.lovable.dev/v1/images/edits) / OpenAI
 * 2. Google Gemini 3.1 Flash-Lite Image (Google AI Studio)
 * 3. Cloudflare Workers AI Neural Img2Img
 * 4. Engine Local Fallback
 */

const engine = require("../../lib/magiclight");
const gemini = require("../../lib/gemini");
const cloudflare = require("../../lib/cloudflare");
const turso = require("../../lib/turso");
const security = require("../../lib/security");

module.exports = async function handler(req, res) {
  security.applySecurityHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const auth = await security.authenticateRequest(req);
  if (!auth.authorized) {
    return res.status(401).json({ error: auth.reason || "Accès refusé : Connexion ou inscription requise." });
  }

  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const prompt = (params.prompt || params.instructions || "Amélioration des détails et mise en scène du personnage").trim();
    const image = params.image || params.imageUrl || params.image_url;
    const ratio = params.ratio || "16:9";

    if (!image) {
      return res.status(400).json({ error: "Le paramètre 'image' ou 'imageUrl' est requis pour la retouche." });
    }

    let remainingCredits = null;
    if (!auth.is_admin && auth.key) {
      remainingCredits = await turso.deductUserCredits(auth.key, 2);
    }

    // --- 1. MOTEUR A : LOVABLE AI GATEWAY / OPENAI IMAGES EDITS ---
    try {
      let imageBuffer = null;
      if (image.startsWith("data:image")) {
        imageBuffer = Buffer.from(image.split(";base64,")[1], "base64");
      } else if (image.startsWith("http")) {
        const imgRes = await fetch(image);
        imageBuffer = Buffer.from(await imgRes.arrayBuffer());
      } else {
        imageBuffer = Buffer.from(image, "base64");
      }

      if (imageBuffer) {
        const lovableGatewayUrl = process.env.LOVABLE_AI_GATEWAY || "https://ai.gateway.lovable.dev/v1/images/edits";
        const lovableHeaders = {
          "Content-Type": "application/json"
        };
        if (process.env.OPENAI_API_KEY || process.env.LOVABLE_API_KEY) {
          lovableHeaders["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY || process.env.LOVABLE_API_KEY}`;
        }

        const editPayload = {
          image: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
          prompt,
          n: 1,
          size: ratio === "9:16" ? "1024x1792" : "1024x1024",
          response_format: "b64_json"
        };

        const gatewayRes = await fetch(lovableGatewayUrl, {
          method: "POST",
          headers: lovableHeaders,
          body: JSON.stringify(editPayload),
          signal: AbortSignal.timeout(15000)
        });

        if (gatewayRes.ok) {
          const gData = await gatewayRes.json();
          const b64Out = gData.data?.[0]?.b64_json;
          const urlOut = gData.data?.[0]?.url;

          if (b64Out || urlOut) {
            const dataUrl = b64Out ? `data:image/png;base64,${b64Out}` : urlOut;
            return res.status(200).json({
              status: "success",
              image_url: dataUrl,
              data_url: dataUrl,
              prompt,
              ratio,
              credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
              engine: "Lovable AI Gateway (OpenAI Images Edits)"
            });
          }
        }
      }
    } catch (lovableErr) {
      console.warn("[Lovable Gateway Note]:", lovableErr.message);
    }

    // --- 2. MOTEUR B : GOOGLE GEMINI 3.1 FLASH-LITE IMAGE ---
    if (gemini.isConfigured()) {
      try {
        const geminiBuf = await gemini.generateOrEditImage(prompt, { inputImageBase64: image, aspectRatio: ratio });
        if (geminiBuf && geminiBuf.length > 2000) {
          const b64 = geminiBuf.toString("base64");
          const dataUrl = `data:image/jpeg;base64,${b64}`;
          return res.status(200).json({
            status: "success",
            image_url: dataUrl,
            data_url: dataUrl,
            prompt,
            ratio,
            credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited",
            engine: "Google AI Studio (Gemini 3.1 Flash-Lite Image)"
          });
        }
      } catch (gErr) {
        console.warn("[Gemini Edit Note]:", gErr.message);
      }
    }

    // --- 3. MOTEUR C : CLOUDFLARE WORKERS AI / NEURAL FUSION ---
    const result = await engine.editImage({
      image,
      prompt,
      ratio,
      strength: params.strength || 0.60
    });

    return res.status(200).json({
      ...result,
      credits_remaining: remainingCredits !== null ? remainingCredits : "unlimited"
    });
  } catch (err) {
    console.error("[API Edit Error]", err);
    return res.status(500).json({ error: err.message });
  }
};
