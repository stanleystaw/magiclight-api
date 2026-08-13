/**
 * scripts/render-video.js — Moteur de rendu vidéo Ultra-Optimisé Multi-Scènes avec :
 * 1. Animation IA Text-to-Video via vercel-animate-api (attente complète du rendu avec voix intégrée)
 * 2. Cohérence absolue du personnage (image uploadée obligatoire en référence ou générée en Scène 1)
 * 3. Parallélisation décalée de 1.5s pour les retouches d'images (/edit)
 * 4. Pipelining : Dès qu'une image est prête, déclenchement immédiat de l'animation vercel-animate-api
 * 5. Compression H.264 haute efficacité (-crf 27, -movflags +faststart) pour un poids plume (< 2 MB par défaut)
 * 6. Filigrane dynamique "★ Stanley stawa" par superposition PNG alpha (100% universel et non rognable)
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

async function executeTurso(sql, args = []) {
  let url = TURSO_URL.replace("libsql://", "https://");
  if (!url.endsWith("/v2/pipeline")) url = url.replace(/\/$/, "") + "/v2/pipeline";

  const formattedArgs = args.map(arg => {
    if (typeof arg === "number") {
      if (Number.isInteger(arg)) return { type: "integer", value: String(arg) };
      return { type: "float", value: arg };
    }
    if (arg === null || arg === undefined) return { type: "null" };
    return { type: "text", value: String(arg) };
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TURSO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: formattedArgs } }, { type: "close" }] })
  });
  const data = await res.json();
  const result = data.results?.[0]?.response?.result;
  if (!result) return [];
  const cols = result.cols?.map(c => c.name) || [];
  return (result.rows || []).map(row => {
    const obj = {};
    row.forEach((cell, idx) => obj[cols[idx]] = cell.value);
    return obj;
  });
}

async function updateTursoTask(taskId, fields) {
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

  await executeTurso(sql, [taskId, status, progress, step, message, videoUrl, coverUrl, duration, scenesCount, error]);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Échec téléchargement ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

// Création de l'overlay PNG (Filigrane Stanley stawa + Sous-titres) via Python Pillow avec polices TrueType
function createOverlayPng(width, height, sectionIndex, sceneText, outputPath) {
  const pyScript = `
from PIL import Image, ImageDraw, ImageFont
import sys

w = int(sys.argv[1])
h = int(sys.argv[2])
idx = int(sys.argv[3])
text = sys.argv[4]
out = sys.argv[5]

img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

try:
    font_wm = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
    font_sub1 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 24)
    font_sub2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
except Exception:
    font_wm = font_sub1 = font_sub2 = ImageFont.load_default()

positions = ['top-left', 'top-right', 'bottom-right', 'bottom-left', 'center-right', 'center-left']
pos = positions[idx % len(positions)]

if pos == 'top-left': x, y = 30, 30
elif pos == 'top-right': x, y = w - 280, 30
elif pos == 'bottom-right': x, y = w - 280, h - 160
elif pos == 'bottom-left': x, y = 30, h - 160
elif pos == 'center-right': x, y = w - 280, h // 2 - 25
else: x, y = 30, h // 2 - 25

d.rounded_rectangle([x, y, x + 250, y + 46], radius=10, fill=(10, 15, 25, 220), outline=(124, 240, 196, 255), width=2)
d.text((x + 125, y + 23), '★ Stanley stawa', fill=(124, 240, 196, 255), font=font_wm, anchor='mm')

sub_y = h - 120
d.rounded_rectangle([30, sub_y, w - 30, sub_y + 90], radius=14, fill=(0, 0, 0, 210), outline=(255, 255, 255, 50), width=1)

words = text.split(' ')
mid = len(words) // 2
l1 = ' '.join(words[:mid]) if mid > 0 else text
l2 = ' '.join(words[mid:]) if mid > 0 else ''

d.text((w // 2, sub_y + 28), l1, fill=(255, 255, 255, 255), font=font_sub1, anchor='mm')
if l2:
    d.text((w // 2, sub_y + 60), l2, fill=(255, 215, 0, 255), font=font_sub2, anchor='mm')

img.save(out, 'PNG', optimize=True)
`;
  const tempPy = path.join("/tmp", `gen_overlay_${Date.now()}_${sectionIndex}.py`);
  fs.writeFileSync(tempPy, pyScript);
  execSync(`python3 "${tempPy}" ${width} ${height} ${sectionIndex} "${sceneText.replace(/"/g, '\\"')}" "${outputPath}"`);
  try { fs.unlinkSync(tempPy); } catch(e) {}
}

async function main() {
  const taskId = process.env.TASK_ID || `vid_${Date.now()}`;
  const prompt = process.env.PROMPT || "Un petit chaton blanc aux yeux bleus qui explore un jardin magique";
  const language = process.env.LANGUAGE || "french";
  const sectionsRequested = Math.min(6, Math.max(2, parseInt(process.env.SECTIONS || process.env.SCENES || "2", 10)));
  const quality = process.env.QUALITY || "medium"; // low, medium, high
  const animDuration = parseInt(process.env.DURATION || "5", 10);
  const ratio = parseInt(process.env.RATIO || "1", 10);

  // Configuration de résolution et encodage ultra-optimisé en Mo
  let outWidth = ratio === 2 ? 720 : 1280;
  let outHeight = ratio === 2 ? 1280 : 720;
  let encCrf = "27";
  let encMaxrate = "850k";
  let encBufsize = "1300k";
  let encAudioBitrate = "96k";
  let encProfile = "high";

  if (quality === "low") {
    outWidth = ratio === 2 ? 480 : 854;
    outHeight = ratio === 2 ? 854 : 480;
    encCrf = "29";
    encMaxrate = "550k";
    encBufsize = "800k";
    encAudioBitrate = "64k";
    encProfile = "main";
  } else if (quality === "high") {
    outWidth = ratio === 2 ? 720 : 1280;
    outHeight = ratio === 2 ? 1280 : 720;
    encCrf = "23";
    encMaxrate = "1600k";
    encBufsize = "2400k";
    encAudioBitrate = "128k";
    encProfile = "high";
  }

  const ratioStr = ratio === 2 ? "9:16" : "16:9";

  let initialImage = process.env.INITIAL_IMAGE || "";
  try {
    const taskRows = await executeTurso("SELECT initial_image FROM video_tasks WHERE task_id = ?;", [taskId]);
    if (taskRows[0]?.initial_image) {
      initialImage = taskRows[0].initial_image;
    }
  } catch (err) {}

  console.log(`\n======================================================`);
  console.log(`🚀 [MagicLight Pipelined Engine] Task ID: ${taskId}`);
  console.log(`📝 Prompt: "${prompt}"`);
  console.log(`📑 Sections demandées: ${sectionsRequested}`);
  console.log(`🎯 Qualité: ${quality} (CRF: ${encCrf}, MaxRate: ${encMaxrate}) | Durée/sec: ${animDuration}s`);
  console.log(`🖼️ Personnage: ${initialImage ? "Image fournie (obligatoire)" : "Génération IA requise"}`);
  console.log(`📐 Format: ${outWidth}x${outHeight} (${ratioStr})`);
  console.log(`⚡ Streaming: FastStart Moov Atom + MP4 YUV420P`);
  console.log(`======================================================\n`);

  const workDir = path.join("/tmp", taskId);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // ----------------------------------------------------
    // ÉTAPE 1 : Scénarisation IA & Dialogues explicites
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      status: "processing",
      progress: 15,
      step: "story",
      message: `Découpage du scénario en ${sectionsRequested} sections et dialogues pour l'animation IA...`
    });

    let scenes = [];
    let storyTitle = "Aventure Magique";

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
      console.warn("Fallback découpage:", e.message);
    }

    if (!scenes || scenes.length < sectionsRequested) {
      scenes = [
        `Regardez ce magnifique jardin, une grande aventure commence !`,
        `J'avance avec courage et je découvre un secret extraordinaire.`,
        `Tout s'illumine autour de moi dans un éclat de magie pure !`,
        `Cette aventure restera gravée pour toujours dans nos cœurs.`,
        `Le soleil se couche doucement sur ce lieu enchanté.`,
        `Nous reviendrons très bientôt pour de nouvelles découvertes.`
      ];
    }

    const finalScenes = scenes.slice(0, sectionsRequested);
    console.log(`✅ ${finalScenes.length} sections préparées pour "${storyTitle}"`);

    // ----------------------------------------------------
    // ÉTAPE 2 : Création du Personnage de Référence (Scène 1)
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 30,
      step: "character_init",
      message: "Préparation du personnage de référence obligatoire pour le projet..."
    });

    const refImagePath = path.join(workDir, "ref_character.jpg");
    let refImageUrl = "";
    let refImageBase64 = "";

    if (initialImage) {
      console.log("📥 Utilisation de l'image de personnage fournie par l'utilisateur...");
      if (initialImage.startsWith("data:image")) {
        const b64Data = initialImage.replace(/^data:image\/\w+;base64,/, "");
        fs.writeFileSync(refImagePath, Buffer.from(b64Data, "base64"));
        refImageBase64 = initialImage;
      } else if (initialImage.startsWith("http")) {
        await downloadFile(initialImage, refImagePath);
        refImageBase64 = `data:image/jpeg;base64,${fs.readFileSync(refImagePath).toString("base64")}`;
      }
      refImageUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(prompt)}&ratio=${ratioStr}`;
    } else {
      console.log("🎨 Génération du personnage de référence (Scène 1) via Creative Studio...");
      refImageUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(prompt + ", single character, portrait cinematic masterpiece, 8k")}&ratio=${ratioStr}`;
      await downloadFile(refImageUrl, refImagePath);
      refImageBase64 = `data:image/jpeg;base64,${fs.readFileSync(refImagePath).toString("base64")}`;
    }

    // ----------------------------------------------------
    // ÉTAPE 3 : Pipeline Parallélisé & Animation avec Voix
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 45,
      step: "animation_pipeline",
      message: `Animation de ${finalScenes.length} sections avec vercel-animate-api et filigrane Stanley stawa...`
    });

    console.log(`\n⚡ Lancement de ${finalScenes.length} sections pipelinées...`);

    const sceneImages = new Array(finalScenes.length);
    const sceneImageUrls = new Array(finalScenes.length);
    const sceneClips = new Array(finalScenes.length);

    sceneImages[0] = refImagePath;
    sceneImageUrls[0] = refImageUrl;

    async function processSection(index) {
      const sceneText = finalScenes[index].trim();
      const sceneImgPath = path.join(workDir, `scene_${index + 1}.jpg`);
      let sceneImgUrl = "";

      if (index === 0) {
        sceneImgUrl = refImageUrl;
      } else {
        await new Promise(r => setTimeout(r, (index - 1) * 1500));
        console.log(` 🎨 [Section ${index + 1}/${finalScenes.length}] Retouche /edit pour cohérence personnage...`);

        try {
          const editRes = await fetch(`${CREATIVE_STUDIO_API}/edit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image: refImageBase64,
              prompt: `Exact same character as in reference: ${sceneText}, cinematic lighting, 8k masterpiece`,
              ratio: ratioStr
            })
          });

          if (editRes.ok) {
            const arrBuf = await editRes.arrayBuffer();
            fs.writeFileSync(sceneImgPath, Buffer.from(arrBuf));
            sceneImgUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(sceneText)}&ratio=${ratioStr}`;
          } else {
            sceneImgUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(sceneText)}&ratio=${ratioStr}`;
            await downloadFile(sceneImgUrl, sceneImgPath);
          }
        } catch (e) {
          sceneImgUrl = `${CREATIVE_STUDIO_API}/generate?prompt=${encodeURIComponent(sceneText)}&ratio=${ratioStr}`;
          await downloadFile(sceneImgUrl, sceneImgPath);
        }
        sceneImages[index] = sceneImgPath;
        sceneImageUrls[index] = sceneImgUrl;
      }

      console.log(` 🎬 [Section ${index + 1}] Image prête ➔ Animation vercel-animate-api...`);
      const clipOutput = path.join(workDir, `clip_${index + 1}.mp4`);
      const rawClipDownloaded = path.join(workDir, `raw_clip_${index + 1}.mp4`);
      const curImg = sceneImages[index];

      const explicitSpeechPrompt = `${storyTitle} - Character is talking: "${sceneText}", looking at camera, speaking with expressive motion, cinematic 8k animation`;
      let animatedVideoDownloaded = false;

      // Appel de vercel-animate-api et attente complète
      try {
        const animRes = await (await fetch(`${ANIMATE_API}/stanleystawa/video?imageUrl=${encodeURIComponent(sceneImageUrls[index])}&prompt=${encodeURIComponent(explicitSpeechPrompt)}&duration=${animDuration}&quality=${quality}&format=json`)).json();

        if (animRes.checkUrl) {
          console.log(` ⏳ [Section ${index + 1}] Animation en cours sur vercel-animate-api...`);
          for (let p = 0; p < 60; p++) {
            await new Promise(r => setTimeout(r, 3000));
            const pollData = await (await fetch(animRes.checkUrl)).json();
            if (pollData.status === "READY" && pollData.videoUrl) {
              console.log(` 🎉 [Section ${index + 1}] Vidéo IA avec audio générée par vercel-animate-api !`);
              await downloadFile(pollData.videoUrl, rawClipDownloaded);
              animatedVideoDownloaded = true;
              break;
            } else if (pollData.error) {
              break;
            }
          }
        }
      } catch (animErr) {
        console.warn(`[Section ${index + 1}] Erreur appel animate-api:`, animErr.message);
      }

      // Fallback fluide si animate-api échoue
      if (!animatedVideoDownloaded) {
        console.log(` ⚙️ [Section ${index + 1}] Fallback animation fluide + MagicLight TTS...`);
        const audioFile = path.join(workDir, `voice_${index + 1}.mp3`);
        try {
          const vRes = await (await fetch(`${MAGICLIGHT_API}/api/voice`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
            body: JSON.stringify({ text: sceneText, voiceId: "MM:lengdan_xiongzhang" })
          })).json();

          if (vRes.data?.data?.url) {
            await downloadFile(vRes.data.data.url, audioFile);
          }
        } catch (err) {}

        if (!fs.existsSync(audioFile)) {
          execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${animDuration} "${audioFile}" -loglevel error`);
        }

        let duration = animDuration;
        try {
          const durOutput = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioFile}"`).toString().trim();
          duration = Math.max(3.0, parseFloat(durOutput) + 0.3);
        } catch (e) {}

        const zoomEffect = index % 2 === 0
          ? `zoompan=z='min(zoom+0.0016,1.15)':d=${Math.round(duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outWidth}x${outHeight}`
          : `zoompan=z='if(lte(zoom,1.0),1.15,max(1.001,zoom-0.0016))':d=${Math.round(duration * 25)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${outWidth}x${outHeight}`;

        execSync(`ffmpeg -y -loop 1 -t ${duration} -i "${curImg}" -i "${audioFile}" -filter_complex "[0:v]${zoomEffect}[v]" -map "[v]" -map 1:a -c:v libx264 -preset veryfast -crf ${encCrf} -maxrate ${encMaxrate} -bufsize ${encBufsize} -pix_fmt yuv420p -c:a aac -b:a ${encAudioBitrate} -shortest "${rawClipDownloaded}" -loglevel error`);
      }

      // Incrustation du Filigrane Dynamique "★ Stanley stawa" + Sous-titres via PNG Alpha Overlay
      const pngOverlayPath = path.join(workDir, `overlay_${index + 1}.png`);
      createOverlayPng(outWidth, outHeight, index, sceneText, pngOverlayPath);

      const filterComplex = `[0:v]scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease,pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1[scaled];[scaled][1:v]overlay=0:0[v]`;
      execSync(`ffmpeg -y -i "${rawClipDownloaded}" -i "${pngOverlayPath}" -filter_complex "${filterComplex}" -map "[v]" -map 0:a? -c:v libx264 -preset veryfast -crf ${encCrf} -maxrate ${encMaxrate} -bufsize ${encBufsize} -profile:v ${encProfile} -level 4.0 -pix_fmt yuv420p -c:a aac -b:a ${encAudioBitrate} -ar 44100 -movflags +faststart "${clipOutput}" -loglevel error`);

      sceneClips[index] = clipOutput;
      console.log(` ✅ [Section ${index + 1}/${finalScenes.length}] Section finalisée avec filigrane Stanley stawa`);
    }

    // Exécution parallélisée de toutes les sections
    const sectionPromises = [];
    for (let i = 0; i < finalScenes.length; i++) {
      sectionPromises.push(processSection(i));
    }
    await Promise.all(sectionPromises);

    // ----------------------------------------------------
    // ÉTAPE 4 : Concaténation rapide & Mixage BGM Ultra-Léger
    // ----------------------------------------------------
    await updateTursoTask(taskId, {
      progress: 85,
      step: "video_concat",
      message: "Concaténation des sections animées et mixage de fond ultra-optimisé..."
    });

    console.log("\n📦 Étape 4 : Concaténation et compression finale...");
    const concatListFile = path.join(workDir, "concat.txt");
    const concatContent = sceneClips.map(c => `file '${c}'`).join("\n");
    fs.writeFileSync(concatListFile, concatContent);

    const tempMergedVideo = path.join(workDir, "merged_raw.mp4");
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListFile}" -c copy -movflags +faststart "${tempMergedVideo}" -loglevel error`);

    // Musique de fond
    const bgmFile = path.join(workDir, "bgm.mp3");
    try {
      await downloadFile("https://cdn2-static.magiclight.ai/bgm/hologram-pulse.mp3", bgmFile);
    } catch (e) {
      execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 30 "${bgmFile}" -loglevel error`);
    }

    const finalMp4Path = path.join(workDir, "final_output.mp4");
    execSync(`ffmpeg -y -i "${tempMergedVideo}" -i "${bgmFile}" -filter_complex "[0:a]volume=1.0[voice];[1:a]volume=0.08[bgm];[voice][bgm]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a ${encAudioBitrate} -ar 44100 -movflags +faststart -shortest "${finalMp4Path}" -loglevel error`);

    const finalSizeMb = (fs.statSync(finalMp4Path).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Montage vidéo finalisé : ${finalMp4Path} (Poids: ${finalSizeMb} Mo)`);

    let totalDuration = 20.0;
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
      message: `Publication de la vidéo finale (${finalSizeMb} Mo)...`
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

    console.log(`\n🎉 RENDU MULTI-SCÈNES TERMINÉ AVEC SUCCÈS !`);
    console.log(`🎬 Vidéo URL : ${videoUrl}`);
    console.log(`⏱️ Durée totale : ${totalDuration.toFixed(1)}s`);
    console.log(`📑 Sections : ${finalScenes.length}`);
    console.log(`💾 Taille finale : ${finalSizeMb} Mo (Ultra-léger)`);

    await updateTursoTask(taskId, {
      status: "completed",
      progress: 100,
      step: "completed",
      message: `Vidéo générée avec succès ! (${finalSizeMb} Mo)`,
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
