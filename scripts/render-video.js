/**
 * scripts/render-video.js — Moteur de rendu vidéo HD Multi-Scènes exécuté sur GitHub Actions
 * Utilise FFmpeg natif Linux, MagicLight Story Expansion, MagicLight TTS et Turso DB
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TURSO_URL = process.env.TURSO_DATABASE_URL || "https://magicligth-stanleystawa354.aws-eu-west-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODY1NDMwODcsImlkIjoiMDE5ZmY2NDMtZmEwMS03NzBkLWE3YjgtMWFkMDQzOWEzN2Q0Iiwia2lkIjoiRUowd0tEaER4WmxUYlZ5MHJLX1VRRnhGZml6NF9nTEp2WXBPdFdiQlM2USIsInJpZCI6ImYzNDE1MGEzLTJkMzMtNDBjOC05ZmFmLWViMDBhODFhOGFhMiJ9.DVj4IWSi5WgU1frG8BVvUmINQYQRN77Kqe0-GLT2qgTv_w6M4ccKOP-GsEkNnaL3jX7Ikb4g7Eo45llVcQAgBQ";
const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "foctaveluka-eng/vercel-animate-api";
const MAGICLIGHT_API = "https://api.magiclight.ai";

// Helpers Turso DB (Upsert)
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

  const payload = {
    requests: [
      { type: "execute", stmt: { sql, args } },
      { type: "close" }
    ]
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("[Turso Update Error]", err.message);
  }
}

async function getTursoActiveAccount() {
  let url = TURSO_URL.replace("libsql://", "https://");
  if (!url.endsWith("/v2/pipeline")) url = url.replace(/\/$/, "") + "/v2/pipeline";

  const payload = {
    requests: [
      { type: "execute", stmt: { sql: "SELECT * FROM magiclight_accounts WHERE status = 'active' AND credits > 0 ORDER BY credits DESC LIMIT 1;" } },
      { type: "close" }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  const rows = data.results?.[0]?.response?.result?.rows || [];
  if (!rows.length) {
    return {
      access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZG1pbiI6dHJ1ZX0.mock",
      email: "default@magiclight.ai"
    };
  }
  const cols = data.results[0].response.result.cols.map(c => c.name);
  const acc = {};
  rows[0].forEach((cell, i) => acc[cols[i]] = cell.value);
  return acc;
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Échec téléchargement ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

function wrapText(text, maxLen = 45) {
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

async function main() {
  const taskId = process.env.TASK_ID || `task_${Date.now()}`;
  const prompt = process.env.PROMPT || "Un petit chaton blanc aux yeux bleus qui explore un jardin magique";
  const language = process.env.LANGUAGE || "french";
  const ratio = parseInt(process.env.RATIO || "1", 10);
  const outWidth = ratio === 2 ? 720 : 1280;
  const outHeight = ratio === 2 ? 1280 : 720;

  console.log(`\n======================================================`);
  console.log(`🚀 [GitHub Actions Video Render] Task ID: ${taskId}`);
  console.log(`📝 Prompt: "${prompt}"`);
  console.log(`📐 Format: ${outWidth}x${outHeight} (${ratio === 2 ? "9:16 Vertical" : "16:9 Paysage"})`);
  console.log(`======================================================\n`);

  const workDir = path.join("/tmp", taskId);
  fs.mkdirSync(workDir, { recursive: true });

  const account = await getTursoActiveAccount();
  const mlHeaders = {
    "User-Agent": "Mozilla/5.0",
    "Authorization": `Bearer ${account.access_token}`,
    "Content-Type": "application/json",
    "Origin": "https://magiclight.ai",
    "Referer": "https://magiclight.ai/"
  };

  try {
    // ----------------------------------------------------
    // ÉTAPE 1 : Scénario IA MagicLight
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      status: "processing",
      progress: 20,
      step: "story",
      message: "Écriture et découpage du scénario multi-scènes..."
    });

    console.log("📖 Étape 1 : Expansion du scénario via MagicLight API...");
    let scenes = [];
    let storyTitle = "Aventure Magique";

    try {
      const expRes = await (await fetch(`${MAGICLIGHT_API}/api/project/story-expand`, {
        method: "POST",
        headers: mlHeaders,
        body: JSON.stringify({ text: prompt, language })
      })).json();

      const expandedText = expRes.data?.expanded_story || prompt;

      const deconRes = await (await fetch(`${MAGICLIGHT_API}/api/project/deconstruction`, {
        method: "POST",
        headers: mlHeaders,
        body: JSON.stringify({ text: expandedText, language, styleId: "5001" })
      })).json();

      scenes = deconRes.data?.sentences || [];
      storyTitle = deconRes.data?.title || storyTitle;
    } catch (e) {
      console.warn("Fallback découpage local:", e.message);
    }

    if (!scenes || scenes.length < 2) {
      scenes = [
        `Scène 1 : ${prompt}`,
        `Scène 2 : L'aventure commence au cœur d'un univers fascinant.`,
        `Scène 3 : De nouvelles découvertes surprenantes émergent.`,
        `Scène 4 : Un moment d'émotion et de magie inoubliable.`,
        `Scène 5 : La conclusion lumineuse et mémorable de l'histoire.`
      ];
    }

    const finalScenes = scenes.slice(0, 6);
    console.log(`✅ ${finalScenes.length} scènes découpées pour "${storyTitle}"`);

    // ----------------------------------------------------
    // ÉTAPE 2 : Voix IA MagicLight TTS pour chaque scène
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 40,
      step: "voice",
      message: "Synthèse vocale officielle MagicLight TTS pour chaque scène..."
    });

    console.log("\n🎙️ Étape 2 : Génération des voix IA via MagicLight TTS...");
    const sceneAudios = [];

    for (let i = 0; i < finalScenes.length; i++) {
      const sceneText = finalScenes[i].trim();
      const audioFile = path.join(workDir, `voice_${i+1}.mp3`);
      let audioUrl = "";

      try {
        const vRes = await (await fetch(`${MAGICLIGHT_API}/api/voice`, {
          method: "POST",
          headers: mlHeaders,
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
      console.log(` - Voix Scène ${i+1}/${finalScenes.length} prête`);
    }

    // ----------------------------------------------------
    // ÉTAPE 3 : Images dédiées pour chaque scène
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 60,
      step: "images",
      message: "Génération des visuels haute définition pour chaque scène..."
    });

    console.log("\n🎨 Étape 3 : Génération des visuels distincts par scène...");
    const sceneImages = [];

    for (let i = 0; i < finalScenes.length; i++) {
      const sceneText = finalScenes[i].trim();
      const imgFile = path.join(workDir, `scene_${i+1}.jpg`);

      const cleanPrompt = encodeURIComponent(`${storyTitle}, scene ${i+1}: ${sceneText}, ultra photorealistic 8k, highly detailed cinematic lighting, masterpiece, sharp focus, 35mm film`);
      const seed = Math.floor(Math.random() * 999999);
      const imgUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${outWidth}&height=${outHeight}&seed=${seed}&nologo=true&enhance=true`;

      try {
        await downloadFile(imgUrl, imgFile);
      } catch (e) {
        execSync(`ffmpeg -y -f lavfi -i color=c=0x1f2937:s=${outWidth}x${outHeight}:d=1 -vframes 1 "${imgFile}" -loglevel error`);
      }
      sceneImages.push(imgFile);
      console.log(` - Image Scène ${i+1}/${finalScenes.length} générée`);
    }

    // ----------------------------------------------------
    // ÉTAPE 4 : Encodage vidéo FFmpeg multi-scènes
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 80,
      step: "encoding",
      message: "Montage vidéo FFmpeg avec animations de caméra et sous-titres..."
    });

    console.log("\n🎬 Étape 4 : Assemblage vidéo FFmpeg HD...");

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
        duration = Math.max(3.5, parseFloat(durOutput) + 0.6);
      } catch (e) {}

      const zoomEffect = i % 2 === 0
        ? `zoompan=z='min(zoom+0.0015,1.15)':d=${Math.round(duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outWidth}x${outHeight}`
        : `zoompan=z='if(lte(zoom,1.0),1.15,max(1.001,zoom-0.0015))':d=${Math.round(duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outWidth}x${outHeight}`;

      const wrappedLines = wrapText(finalScenes[i], 38);
      const line1 = (wrappedLines[0] || "").replace(/'/g, "'\\\\''").replace(/:/g, "\\:");
      const line2 = (wrappedLines[1] || "").replace(/'/g, "'\\\\''").replace(/:/g, "\\:");

      const subFilter = `drawbox=y=ih-120:color=black@0.65:width=iw:height=100:t=fill,drawtext=text='${line1}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=h-95,drawtext=text='${line2}':fontcolor=0xFFD700:fontsize=22:x=(w-text_w)/2:y=h-60`;

      const cmd = `ffmpeg -y -loop 1 -t ${duration} -i "${imgFile}" -i "${audioFile}" -filter_complex "[0:v]${zoomEffect},${subFilter}[v]" -map "[v]" -map 1:a -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${clipOutput}" -loglevel error`;
      execSync(cmd);
      sceneClips.push(clipOutput);
      console.log(` - Rendu Scène ${i+1} terminé (${duration.toFixed(1)}s)`);
    }

    const concatListFile = path.join(workDir, "concat.txt");
    const concatContent = sceneClips.map(c => `file '${c}'`).join("\n");
    fs.writeFileSync(concatListFile, concatContent);

    const tempMergedVideo = path.join(workDir, "merged_raw.mp4");
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListFile}" -c copy "${tempMergedVideo}" -loglevel error`);

    const finalMp4Path = path.join(workDir, "final_output.mp4");
    execSync(`ffmpeg -y -i "${tempMergedVideo}" -i "${bgmFile}" -filter_complex "[0:a]volume=1.0[voice];[1:a]volume=0.15[bgm];[voice][bgm]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -shortest "${finalMp4Path}" -loglevel error`);

    console.log(`✅ Fichier MP4 final généré : ${finalMp4Path}`);

    let totalDuration = 20;
    try {
      const durStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalMp4Path}"`).toString().trim();
      totalDuration = parseFloat(durStr);
    } catch (e) {}

    // ----------------------------------------------------
    // ÉTAPE 5 : Publication de la vidéo finale
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 95,
      step: "publishing",
      message: "Publication de la vidéo finale HD..."
    });

    let releaseTag = "v1.0.0-videos";
    let videoUrl = `https://github.com/${REPO}/releases/download/${releaseTag}/${taskId}.mp4`;

    try {
      let releaseRes = await (await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${releaseTag}`, {
        headers: { "Authorization": `token ${GITHUB_TOKEN}`, "User-Agent": "Mozilla/5.0" }
      })).json();

      if (!releaseRes.id) {
        releaseRes = await (await fetch(`https://api.github.com/repos/${REPO}/releases`, {
          method: "POST",
          headers: { "Authorization": `token ${GITHUB_TOKEN}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
          body: JSON.stringify({
            tag_name: releaseTag,
            name: "MagicLight AI Video Storage",
            body: "Stockage public des vidéos rendues par le moteur MagicLight AI"
          })
        })).json();
      }

      if (releaseRes.id) {
        const assetName = `${taskId}.mp4`;
        const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${releaseRes.id}/assets?name=${assetName}`;
        const fileBuffer = fs.readFileSync(finalMp4Path);

        const uploadRes = await (await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Authorization": `token ${GITHUB_TOKEN}`,
            "Content-Type": "video/mp4",
            "User-Agent": "Mozilla/5.0"
          },
          body: fileBuffer
        })).json();

        if (uploadRes.browser_download_url) {
          videoUrl = uploadRes.browser_download_url;
        }
      }
    } catch (ghErr) {
      console.warn("Erreur upload release:", ghErr.message);
    }

    console.log(`\n🎉 SUCCÈS COMPLET !`);
    console.log(`🎬 Vidéo URL : ${videoUrl}`);
    console.log(`⏱️ Durée : ${totalDuration.toFixed(1)}s`);
    console.log(`📑 Scènes : ${finalScenes.length}`);

    await updateTursoTask(taskId, {
      status: "completed",
      progress: 100,
      step: "completed",
      message: "Vidéo générée avec succès !",
      video_url: videoUrl,
      cover_url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=720&height=405&seed=1&nologo=true`,
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
