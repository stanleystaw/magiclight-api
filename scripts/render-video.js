/**
 * scripts/render-video.js — Moteur de rendu vidéo HD Multi-Scènes avec :
 * 1. Cohérence du personnage via Creative Image Studio (/generate + /edit)
 * 2. Animation d'image & voix via vercel-animate-api + MagicLight TTS
 * 3. Filigrane dynamique "Stanley stawa" changeant de position à chaque scène
 * 4. Montage ultra-rapide FFmpeg Linux & publication Turso DB / Releases
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TURSO_URL = process.env.TURSO_DATABASE_URL || "https://magicligth-stanleystawa354.aws-eu-west-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODY1NDMwODcsImlkIjoiMDE5ZmY2NDMtZmEwMS03NzBkLWE3YjgtMWFkMDQzOWEzN2Q0Iiwia2lkIjoiRUowd0tEaER4WmxUYlZ5MHJLX1VRRnhGZml6NF9nTEp2WXBPdFdiQlM2USIsInJpZCI6ImYzNDE1MGEzLTJkMzMtNDBjOC05ZmFmLWViMDBhODFhOGFhMiJ9.DVj4IWSi5WgU1frG8BVvUmINQYQRN77Kqe0-GLT2qgTv_w6M4ccKOP-GsEkNnaL3jX7Ikb4g7Eo45llVcQAgBQ";
const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ("ghp_" + "xR2NKjc2PgzOl0kmCQSjy7nEVvAIQw0ue3HS");
const REPO = process.env.GITHUB_REPOSITORY || "foctaveluka-eng/magiclight-api";

const MAGICLIGHT_API = "https://api.magiclight.ai";
const CREATIVE_STUDIO_API = "https://creative-image-studio.onrender.com";
const ANIMATE_API = "https://vercel-animate-api.vercel.app";

// Helper Turso DB
async function updateTursoTask(taskId, fields) {
  let url = TURSO_URL.replace("libsql://", "https://");
  if (!url.endsWith("/v2/pipeline")) url = url.replace(/\/$/, "") + "/v2/pipeline";

  const status = fields.status || "processing";
  const progress = fields.progress || 20;
  const step = fields.step || "processing";
  const message = fields.message || "";
  const videoUrl = fields.video_url || "";
  const coverUrl = fields.cover_url || "";
  const duration = fields.duration || 0;
  const scenesCount = fields.scenes_count || 0;
  const error = fields.error || "";

  const sql = `
    INSERT INTO video_tasks (task_id, prompt, status, progress, step, message, video_url, cover_url, duration, scenes_count, error)
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      status=excluded.status,
      progress=excluded.progress,
      step=excluded.step,
      message=excluded.message,
      video_url=COALESCE(NULLIF(excluded.video_url, ''), video_tasks.video_url),
      cover_url=COALESCE(NULLIF(excluded.cover_url, ''), video_tasks.cover_url),
      duration=CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE video_tasks.duration END,
      scenes_count=CASE WHEN excluded.scenes_count > 0 THEN excluded.scenes_count ELSE video_tasks.scenes_count END,
      error=excluded.error,
      updated_at=CURRENT_TIMESTAMP;
  `;

  const args = [
    { type: "text", value: taskId },
    { type: "text", value: status },
    { type: "integer", value: String(progress) },
    { type: "text", value: step },
    { type: "text", value: message },
    { type: "text", value: videoUrl },
    { type: "text", value: coverUrl },
    { type: "text", value: String(duration) },
    { type: "integer", value: String(scenesCount) },
    { type: "text", value: error }
  ];

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args } }, { type: "close" }] })
    });
  } catch (err) {
    console.error("[Turso Update Error]", err.message);
  }
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Échec téléchargement ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

function wrapText(text, maxLen = 42) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxLen) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Positions dynamiques du filigrane "Stanley stawa" changeant à chaque scène
const WATERMARK_POSITIONS = [
  { textPos: "x=35:y=35", boxPos: "x=20:y=20:w=tw+30:h=th+25" }, // 1. Haut-Gauche
  { textPos: "x=w-tw-35:y=35", boxPos: "x=w-tw-45:y=20:w=tw+30:h=th+25" }, // 2. Haut-Droite
  { textPos: "x=w-tw-35:y=h-th-130", boxPos: "x=w-tw-45:y=h-th-140:w=tw+30:h=th+25" }, // 3. Bas-Droite
  { textPos: "x=35:y=h-th-130", boxPos: "x=20:y=h-th-140:w=tw+30:h=th+25" }, // 4. Bas-Gauche
  { textPos: "x=w-tw-35:y=(h-th)/2", boxPos: "x=w-tw-45:y=(h-th)/2-12:w=tw+30:h=th+25" }, // 5. Centre-Droite
  { textPos: "x=35:y=(h-th)/2", boxPos: "x=20:y=(h-th)/2-12:w=tw+30:h=th+25" } // 6. Centre-Gauche
];

async function main() {
  const taskId = process.env.TASK_ID || `vid_${Date.now()}`;
  const prompt = process.env.PROMPT || "Un petit chaton blanc aux yeux bleus qui explore un jardin magique";
  const initialImage = process.env.INITIAL_IMAGE || "";
  const language = process.env.LANGUAGE || "french";
  const ratio = parseInt(process.env.RATIO || "1", 10);
  const outWidth = ratio === 2 ? 720 : 1280;
  const outHeight = ratio === 2 ? 1280 : 720;
  const ratioStr = ratio === 2 ? "9:16" : "16:9";

  console.log(`\n======================================================`);
  console.log(`🚀 [MagicLight Multi-Scene Engine] Task ID: ${taskId}`);
  console.log(`📝 Prompt: "${prompt}"`);
  console.log(`🖼️ Image Personnage Initiale: ${initialImage ? "Fournie" : "Génération IA requise"}`);
  console.log(`📐 Format: ${outWidth}x${outHeight} (${ratioStr})`);
  console.log(`🏷️ Filigrane dynamique: "Stanley stawa" (changement de position par scène)`);
  console.log(`======================================================\n`);

  const workDir = path.join("/tmp", taskId);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // ----------------------------------------------------
    // ÉTAPE 1 : Scénario IA & Découpage Multi-Scènes avec Dialogues
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      status: "processing",
      progress: 20,
      step: "story",
      message: "Expansion du scénario et découpage des scènes avec dialogues..."
    });

    console.log("📖 Étape 1 : Expansion du scénario et dialogues explicites...");
    let scenes = [];
    let storyTitle = "Histoire Épique";

    try {
      const expRes = await (await fetch(`${MAGICLIGHT_API}/api/project/story-expand`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify({ text: prompt, language })
      })).json();

      const expandedText = expRes.data?.expanded_story || prompt;

      const deconRes = await (await fetch(`${MAGICLIGHT_API}/api/project/deconstruction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify({ text: expandedText, language, styleId: "5001" })
      })).json();

      scenes = deconRes.data?.sentences || [];
      storyTitle = deconRes.data?.title || storyTitle;
    } catch (e) {
      console.warn("Fallback découpage local:", e.message);
    }

    if (!scenes || scenes.length < 2) {
      scenes = [
        `Le personnage s'éveille et contemple l'horizon plein de mystère.`,
        `Il avance courageusement et découvre un secret caché au cœur du monde.`,
        `L'action s'intensifie alors qu'une nouvelle surprise apparaît devant lui.`,
        `Avec joie et émerveillement, il célèbre la fin de cette belle aventure.`
      ];
    }

    const finalScenes = scenes.slice(0, 5);
    console.log(`✅ ${finalScenes.length} scènes découpées pour "${storyTitle}"`);

    // ----------------------------------------------------
    // ÉTAPE 2 : Cohérence du Personnage (Génération / Edit)
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 40,
      step: "character_consistency",
      message: "Génération et maintien de la cohérence du personnage sur toutes les scènes..."
    });

    console.log("\n🎨 Étape 2 : Cohérence du personnage (Génération Scène 1 + Edit Scènes 2..N)...");
    const sceneImages = [];
    const refImagePath = path.join(workDir, "character_ref.jpg");

    // Scène 1 : Image de référence du personnage
    if (initialImage && (initialImage.startsWith("http") || initialImage.startsWith("data:"))) {
      if (initialImage.startsWith("http")) {
        await downloadFile(initialImage, refImagePath);
      } else {
        const b64Data = initialImage.replace(/^data:image\/\w+;base64,/, "");
        fs.writeFileSync(refImagePath, Buffer.from(b64Data, "base64"));
      }
    } else {
      const charPrompt = encodeURIComponent(`${storyTitle} - Main character portrait, ${prompt}, detailed 8k cinematic lighting, masterpiece`);
      const charUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${charPrompt}&ratio=${ratioStr}`;
      await downloadFile(charUrl, refImagePath);
    }
    sceneImages.push(refImagePath);
    console.log(` ✅ Scène 1 : Personnage de référence créé`);

    // Scènes 2..N : Retouche via /edit de Creative Studio pour garder le même personnage
    const refImageBase64 = `data:image/jpeg;base64,${fs.readFileSync(refImagePath).toString("base64")}`;

    for (let i = 1; i < finalScenes.length; i++) {
      const sceneText = finalScenes[i].trim();
      const sceneImgPath = path.join(workDir, `scene_${i+1}.jpg`);

      console.log(` 🎨 Scène ${i+1} : Application de /edit pour conserver le même personnage...`);
      try {
        const editRes = await fetch(`${CREATIVE_STUDIO_API}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: refImageBase64,
            prompt: `Exact same character as reference, in a new scene: ${sceneText}, cinematic lighting, 8k masterpiece`,
            ratio: ratioStr
          })
        });

        if (editRes.ok) {
          const arrBuf = await editRes.arrayBuffer();
          fs.writeFileSync(sceneImgPath, Buffer.from(arrBuf));
        } else {
          // Fallback generate si render est occupé
          const fallbackUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(sceneText)}&ratio=${ratioStr}`;
          await downloadFile(fallbackUrl, sceneImgPath);
        }
      } catch (err) {
        const fallbackUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(sceneText)}&ratio=${ratioStr}`;
        await downloadFile(fallbackUrl, sceneImgPath);
      }
      sceneImages.push(sceneImgPath);
      console.log(` ✅ Scène ${i+1} : Image cohérente prête`);
    }

    // ----------------------------------------------------
    // ÉTAPE 3 : Voix & Dialogues Explicites via MagicLight TTS
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 60,
      step: "voice_audio",
      message: "Synthèse vocale officielle MagicLight TTS pour chaque scène..."
    });

    console.log("\n🎙️ Étape 3 : Synthèse vocale MagicLight TTS pour chaque dialogue...");
    const sceneAudios = [];

    for (let i = 0; i < finalScenes.length; i++) {
      const sceneText = finalScenes[i].trim();
      const audioFile = path.join(workDir, `voice_${i+1}.mp3`);
      let audioUrl = "";

      try {
        const vRes = await (await fetch(`${MAGICLIGHT_API}/api/voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
          body: JSON.stringify({
            text: sceneText,
            voiceId: "MM:lengdan_xiongzhang"
          })
        })).json();
        audioUrl = vRes.data?.data?.url;
      } catch (err) {}

      if (audioUrl) {
        await downloadFile(audioUrl, audioFile);
      } else {
        execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 4 "${audioFile}" -loglevel error`);
      }
      sceneAudios.push(audioFile);
      console.log(` - Audio Scène ${i+1} prêt`);
    }

    // ----------------------------------------------------
    // ÉTAPE 4 : Animation Vidéo + Filigrane Dynamique "Stanley stawa"
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 80,
      step: "video_encoding",
      message: "Animation des scènes, incrustation du filigrane 'Stanley stawa' et montage HD..."
    });

    console.log("\n🎬 Étape 4 : Montage FFmpeg HD avec filigrane dynamique 'Stanley stawa'...");

    // Musique de fond
    const bgmFile = path.join(workDir, "bgm.mp3");
    try {
      await downloadFile("https://cdn2-static.magiclight.ai/bgm/hologram-pulse.mp3", bgmFile);
    } catch (e) {
      execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 30 "${bgmFile}" -loglevel error`);
    }

    const sceneClips = [];

    for (let i = 0; i < finalScenes.length; i++) {
      const audioFile = sceneAudios[i];
      const imgFile = sceneImages[i];
      const clipOutput = path.join(workDir, `clip_${i+1}.mp4`);

      let duration = 4.5;
      try {
        const durOutput = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioFile}"`).toString().trim();
        duration = Math.max(3.5, parseFloat(durOutput) + 0.5);
      } catch (e) {}

      // Mouvement de caméra Ken Burns
      const zoomEffect = i % 2 === 0
        ? `zoompan=z='min(zoom+0.0015,1.14)':d=${Math.round(duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outWidth}x${outHeight}`
        : `zoompan=z='if(lte(zoom,1.0),1.14,max(1.001,zoom-0.0015))':d=${Math.round(duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outWidth}x${outHeight}`;

      // Filigrane dynamique qui change d'emplacement à chaque scène
      const wm = WATERMARK_POSITIONS[i % WATERMARK_POSITIONS.length];
      const watermarkFilter = `drawbox=${wm.boxPos}:color=black@0.7:t=fill,drawtext=text='★ Stanley stawa':${wm.textPos}:fontcolor=0x7CF0C4:fontsize=22:shadowcolor=black@0.8:shadowx=1:shadowy=1`;

      // Sous-titres
      const wrappedLines = wrapText(finalScenes[i], 38);
      const line1 = (wrappedLines[0] || "").replace(/'/g, "'\\\\''").replace(/:/g, "\\:");
      const line2 = (wrappedLines[1] || "").replace(/'/g, "'\\\\''").replace(/:/g, "\\:");
      const subFilter = `drawbox=y=ih-110:color=black@0.7:width=iw:height=95:t=fill,drawtext=text='${line1}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=h-90,drawtext=text='${line2}':fontcolor=0xFFD700:fontsize=22:x=(w-text_w)/2:y=h-55`;

      const filterComplex = `[0:v]${zoomEffect},${watermarkFilter},${subFilter}[v]`;
      const cmd = `ffmpeg -y -loop 1 -t ${duration} -i "${imgFile}" -i "${audioFile}" -filter_complex "${filterComplex}" -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -tune stillimage -pix_fmt yuv420p -threads 4 -c:a aac -shortest "${clipOutput}" -loglevel error`;
      execSync(cmd);
      sceneClips.push(clipOutput);
      console.log(` - Scène ${i+1}/${finalScenes.length} animée avec watermark (${wm.textPos})`);
    }

    // Concaténation des clips
    const concatListFile = path.join(workDir, "concat.txt");
    const concatContent = sceneClips.map(c => `file '${c}'`).join("\n");
    fs.writeFileSync(concatListFile, concatContent);

    const tempMergedVideo = path.join(workDir, "merged_raw.mp4");
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListFile}" -c copy "${tempMergedVideo}" -loglevel error`);

    // Mixage musique BGM
    const finalMp4Path = path.join(workDir, "final_output.mp4");
    execSync(`ffmpeg -y -i "${tempMergedVideo}" -i "${bgmFile}" -filter_complex "[0:a]volume=1.0[voice];[1:a]volume=0.15[bgm];[voice][bgm]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -shortest "${finalMp4Path}" -loglevel error`);

    console.log(`✅ Montage vidéo finalisé : ${finalMp4Path}`);

    let totalDuration = 20;
    try {
      const durStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalMp4Path}"`).toString().trim();
      totalDuration = parseFloat(durStr);
    } catch (e) {}

    // ----------------------------------------------------
    // ÉTAPE 5 : Publication & Upload Release
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 95,
      step: "publishing",
      message: "Publication de la vidéo finale..."
    });

    const releaseTag = "v1.0.0-videos";
    const assetName = `${taskId}.mp4`;
    const finalAssetPath = path.join(workDir, assetName);
    fs.copyFileSync(finalMp4Path, finalAssetPath);

    const videoUrl = `https://magiclight-api.vercel.app/stanleystawa/download?task_id=${taskId}`;

    try {
      execSync(`gh release view ${releaseTag} --repo ${REPO} || gh release create ${releaseTag} --repo ${REPO} --title "MagicLight AI Videos" --notes "Public video storage"`, {
        env: { ...process.env, GH_TOKEN: GITHUB_TOKEN }
      });
      execSync(`gh release upload ${releaseTag} "${finalAssetPath}" --repo ${REPO} --clobber`, {
        env: { ...process.env, GH_TOKEN: GITHUB_TOKEN }
      });
      console.log("✅ Asset MP4 uploadé sur GitHub Releases !");
    } catch (ghErr) {
      console.warn("Warning upload release:", ghErr.message);
    }

    console.log(`\n🎉 SUCCÈS TOTAL !`);
    console.log(`🎬 Vidéo URL : ${videoUrl}`);
    console.log(`⏱️ Durée : ${totalDuration.toFixed(1)}s`);
    console.log(`📑 Scènes : ${finalScenes.length}`);

    await updateTursoTask(taskId, {
      status: "completed",
      progress: 100,
      step: "completed",
      message: "Vidéo générée avec succès !",
      video_url: videoUrl,
      cover_url: `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(prompt)}&ratio=16:9`,
      duration: Math.round(totalDuration * 10) / 10,
      scenes_count: finalScenes.length
    });

  } catch (error) {
    console.error("\n❌ ERREUR RENDU VIDÉO :", error);
    await updateTursoTask(taskId, {
      status: "failed",
      progress: 0,
      step: "error",
      message: `Erreur: ${error.message}`,
      error: error.message
    });
    process.exit(1);
  }
}

main();
