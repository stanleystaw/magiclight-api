"""
Stanley Video Engine Worker — Hugging Face Space FastAPI Service
Montage Vidéo Multi-Scènes FFmpeg + Edge-TTS + Filigrane dynamique ★ Stanley stawa + Turso libSQL
"""

import os
import sys
import glob
import math
import time
import json
import shutil
import asyncio
import hashlib
import logging
import subprocess
from typing import Optional, List, Dict, Any

import requests
from fastapi import FastAPI, BackgroundTasks, Query, Header, HTTPException
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, ImageDraw, ImageFont

# Configuration & Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("hf-video-worker")

app = FastAPI(title="Stanley Video Engine Worker", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environnement & Identifiants
TURSO_URL = os.environ.get("TURSO_DATABASE_URL", "https://magicligth-stanleystawa354.aws-eu-west-1.turso.io")
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODY1NDMwODcsImlkIjoiMDE5ZmY2NDMtZmEwMS03NzBkLWE3YjgtMWFkMDQzOWEzN2Q0Iiwia2lkIjoiRUowd0tEaER4WmxUYlZ5MHJLX1VRRnhGZml6NF9nTEp2WXBPdFdiQlM2USIsInJpZCI6ImYzNDE1MGEzLTJkMzMtNDBjOC05ZmFmLWViMDBhODFhOGFhMiJ9.DVj4IWSi5WgU1frG8BVvUmINQYQRN77Kqe0-GLT2qgTv_w6M4ccKOP-GsEkNnaL3jX7Ikb4g7Eo45llVcQAgBQ")
MASTER_KEY = os.environ.get("API_KEY", "stanleystawa_live_9f83a7c4e2b1d680a7e4b9c1d2e3f5")
BASE_URL = os.environ.get("SPACE_HOST", os.environ.get("BASE_URL", ""))

OUTPUTS_DIR = "/tmp/video_outputs"
os.makedirs(OUTPUTS_DIR, exist_ok=True)


# ==========================================
# 1. Helper Base de Données Turso libSQL
# ==========================================
async def execute_turso(sql: str, args: List[Any] = None) -> List[Dict[str, Any]]:
    """Exécute une requête SQL sur Turso via le pipeline HTTPS."""
    if args is None:
        args = []

    url = TURSO_URL.replace("libsql://", "https://")
    if not url.endswith("/v2/pipeline"):
        url = url.rstrip("/") + "/v2/pipeline"

    formatted_args = []
    for arg in args:
        if isinstance(arg, int):
            formatted_args.append({"type": "integer", "value": str(arg)})
        elif isinstance(arg, float):
            formatted_args.append({"type": "float", "value": arg})
        elif arg is None:
            formatted_args.append({"type": "null"})
        else:
            formatted_args.append({"type": "text", "value": str(arg)})

    payload = {
        "requests": [
            {
                "type": "execute",
                "stmt": {"sql": sql, "args": formatted_args}
            },
            {"type": "close"}
        ]
    }

    try:
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(
            None,
            lambda: requests.post(
                url,
                headers={"Authorization": f"Bearer {TURSO_TOKEN}", "Content-Type": "application/json"},
                json=payload,
                timeout=12
            )
        )
        if not res.ok:
            logger.warning(f"Turso HTTP error: {res.status_code} {res.text}")
            return []

        data = res.json()
        result = data.get("results", [{}])[0].get("response", {}).get("result", {})
        cols = [c.get("name") for c in result.get("cols", [])]
        rows = []
        for r in result.get("rows", []):
            row_dict = {}
            for idx, cell in enumerate(r):
                row_dict[cols[idx]] = cell.get("value")
            rows.append(row_dict)
        return rows
    except Exception as e:
        logger.error(f"Erreur Turso Execute: {e}")
        return []


async def update_turso_task(task_id: str, updates: Dict[str, Any]):
    """Met à jour l'état de la tâche dans Turso."""
    status = updates.get("status", "processing")
    progress = updates.get("progress", 50)
    step = updates.get("step", "rendering")
    message = updates.get("message", "Compilation en cours...")
    video_url = updates.get("video_url", "")
    cover_url = updates.get("cover_url", "")
    duration = updates.get("duration", 0)
    scenes_count = updates.get("scenes_count", 0)
    error = updates.get("error", "")

    sql = """
        INSERT INTO video_tasks (task_id, prompt, status, progress, step, message, video_url, cover_url, duration, scenes_count, error)
        VALUES (?, 'Film IA Stanley Stawa', ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    """
    await execute_turso(sql, [task_id, status, progress, step, message, video_url, cover_url, duration, scenes_count, error])


# ==========================================
# 2. Synthèse Vocale Edge-TTS (100% Gratuite)
# ==========================================
async def generate_edge_tts(text: str, output_audio_path: str, language: str = "french"):
    """Génère un fichier audio MP3 de qualité studio avec Edge-TTS."""
    voice = "fr-FR-HenriNeural" if "fr" in language.lower() else "en-US-ChristopherNeural"
    cmd = f'edge-tts --voice "{voice}" --text "{text.replace(chr(34), "")}" --write-media "{output_audio_path}"'
    
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, lambda: subprocess.run(cmd, shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        if os.path.exists(output_audio_path) and os.path.getsize(output_audio_path) > 100:
            return True
    except Exception as e:
        logger.warning(f"Edge-TTS command failed, using ffmpeg silence fallback: {e}")

    # Fallback silence audio
    fallback_cmd = f'ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 5 "{output_audio_path}" -loglevel error'
    subprocess.run(fallback_cmd, shell=True, check=False)
    return False


# ==========================================
# 3. Filigrane & Sous-titres dynamiques Pillow
# ==========================================
def create_overlay_png(width: int, height: int, section_idx: int, scene_text: str, out_path: str):
    """Génère l'incrustation avec le filigrane cyclé ★ Stanley stawa et les sous-titres."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    font_wm = None
    font_sub = None
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                font_wm = ImageFont.truetype(fp, size=max(18, int(height * 0.038)))
                font_sub = ImageFont.truetype(fp, size=max(16, int(height * 0.034)))
                break
            except Exception:
                continue

    if not font_wm:
        font_wm = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    wm_text = "★ Stanley stawa"
    pos_mode = section_idx % 6
    pad_x = int(width * 0.03)
    pad_y = int(height * 0.04)

    try:
        bbox_wm = font_wm.getbbox(wm_text)
        wm_w = bbox_wm[2] - bbox_wm[0]
        wm_h = bbox_wm[3] - bbox_wm[1]
    except Exception:
        wm_w, wm_h = (150, 24)

    if pos_mode == 0:
        wm_x, wm_y = pad_x, pad_y
    elif pos_mode == 1:
        wm_x, wm_y = (width - wm_w) // 2, pad_y
    elif pos_mode == 2:
        wm_x, wm_y = width - wm_w - pad_x, pad_y
    elif pos_mode == 3:
        wm_x, wm_y = pad_x, height - wm_h - int(height * 0.16)
    elif pos_mode == 4:
        wm_x, wm_y = (width - wm_w) // 2, height - wm_h - int(height * 0.16)
    else:
        wm_x, wm_y = width - wm_w - pad_x, height - wm_h - int(height * 0.16)

    # Boîte et texte du filigrane
    draw.rounded_rectangle(
        [wm_x - 10, wm_y - 6, wm_x + wm_w + 10, wm_y + wm_h + 6],
        radius=6,
        fill=(15, 20, 30, 160),
        outline=(124, 240, 196, 140),
        width=1
    )
    draw.text((wm_x, wm_y), wm_text, font=font_wm, fill=(255, 255, 255, 245))

    # Sous-titres
    if scene_text:
        words = scene_text.split()
        lines = []
        curr = []
        for word in words:
            curr.append(word)
            test_line = " ".join(curr)
            try:
                bbox = font_sub.getbbox(test_line)
                line_w = bbox[2] - bbox[0]
            except Exception:
                line_w = len(test_line) * 10
            if line_w > width * 0.85:
                curr.pop()
                lines.append(" ".join(curr))
                curr = [word]
        if curr:
            lines.append(" ".join(curr))

        sub_y = height - int(height * 0.12) - (len(lines) * 28)
        for line in lines:
            try:
                bbox = font_sub.getbbox(line)
                line_w = bbox[2] - bbox[0]
                line_h = bbox[3] - bbox[1]
            except Exception:
                line_w, line_h = (len(line) * 10, 20)
            line_x = (width - line_w) // 2
            draw.rounded_rectangle([line_x - 12, sub_y - 4, line_x + line_w + 12, sub_y + line_h + 4], radius=4, fill=(0, 0, 0, 180))
            draw.text((line_x, sub_y), line, font=font_sub, fill=(255, 255, 255, 255))
            sub_y += line_h + 10

    img.save(out_path, "PNG")


# ==========================================
# 4. Partitionnement de scénario
# ==========================================
def partition_text(text: str, n_sections: int) -> List[str]:
    """Divise un prompt ou une histoire en N sections équilibrées."""
    sentences = [s.strip() for s in text.replace("\n", ". ").split(".") if s.strip()]
    if not sentences:
        return [text] * n_sections

    if len(sentences) >= n_sections:
        chunk_size = len(sentences) / n_sections
        res = []
        for i in range(n_sections):
            start = int(i * chunk_size)
            end = int((i + 1) * chunk_size)
            chunk = sentences[start:end]
            res.append(" ".join(chunk))
        return res

    res = list(sentences)
    while len(res) < n_sections:
        longest_idx = max(range(len(res)), key=lambda i: len(res[i]))
        words = res[longest_idx].split()
        if len(words) <= 3:
            res.append(res[longest_idx])
            break
        mid = len(words) // 2
        p1 = " ".join(words[:mid])
        p2 = " ".join(words[mid:])
        res[longest_idx] = p1
        res.insert(longest_idx + 1, p2)

    return res[:n_sections]


# ==========================================
# 5. Moteur de rendu complet
# ==========================================
async def render_video_pipeline(
    task_id: str,
    prompt: str,
    initial_image: str = "",
    sections: int = 6,
    quality: str = "medium",
    duration: int = 10,
    ratio: str = "1",
    language: str = "french"
):
    """Pipeline de rendu vidéo complet asynchrone."""
    work_dir = f"/tmp/render_{task_id}"
    os.makedirs(work_dir, exist_ok=True)

    is_portrait = str(ratio) == "2"
    target_width = 720 if is_portrait else 1280
    target_height = 1280 if is_portrait else 720

    crf = 27 if quality == "medium" else (29 if quality == "low" else 23)
    maxrate = "750k" if quality == "medium" else ("550k" if quality == "low" else "1100k")
    bufsize = "1100k" if quality == "medium" else ("850k" if quality == "low" else "1600k")

    logger.info(f"🎬 Début du rendu tâche {task_id} ({sections} sections, {target_width}x{target_height})")

    try:
        await update_turso_task(task_id, {
            "status": "processing",
            "progress": 25,
            "step": "character_init",
            "message": "Calibration du personnage et préparation des scènes..."
        })

        # 1. Récupération de l'image de référence
        ref_image_path = os.path.join(work_dir, "ref_character.jpg")
        if initial_image and initial_image.startswith("http"):
            try:
                r = requests.get(initial_image, timeout=15)
                with open(ref_image_path, "wb") as f:
                    f.write(r.content)
            except Exception as e:
                logger.warning(f"Download initial_image failed: {e}")

        if not os.path.exists(ref_image_path) or os.path.getsize(ref_image_path) < 1000:
            # Fallback Pollinations Flux HD
            try:
                seed = int(time.time()) % 1000000
                flux_url = f"https://image.pollinations.ai/prompt/{requests.utils.quote(prompt + ', 8k cinematic portrait')}?width={target_width}&height={target_height}&nologo=true&seed={seed}&model=flux"
                r = requests.get(flux_url, timeout=15)
                with open(ref_image_path, "wb") as f:
                    f.write(r.content)
            except Exception:
                pass

        if not os.path.exists(ref_image_path):
            img = Image.new("RGB", (target_width, target_height), (20, 28, 45))
            draw = ImageDraw.Draw(img)
            draw.ellipse([target_width//4, target_height//4, target_width*3//4, target_height*3//4], fill=(60, 90, 130))
            img.save(ref_image_path, "JPEG")

        # Recadrage propre
        try:
            with Image.open(ref_image_path) as im:
                from PIL import ImageOps
                fitted = ImageOps.fit(im, (target_width, target_height), Image.Resampling.LANCZOS)
                fitted.convert("RGB").save(ref_image_path, "JPEG", quality=95)
        except Exception as e:
            logger.warning(f"Image crop note: {e}")

        # 2. Découpage en scènes
        scene_texts = partition_text(prompt, sections)
        scene_clips = []

        await update_turso_task(task_id, {
            "progress": 45,
            "step": "rendering_scenes",
            "message": f"Compilation des {len(scene_texts)} scènes avec voix et filigrane..."
        })

        # 3. Compilation des scènes
        for idx, scene_text in enumerate(scene_texts):
            scene_img = os.path.join(work_dir, f"scene_{idx+1}.jpg")
            shutil.copy(ref_image_path, scene_img)

            overlay_img = os.path.join(work_dir, f"overlay_{idx+1}.png")
            create_overlay_png(target_width, target_height, idx, scene_text, overlay_img)

            voice_audio = os.path.join(work_dir, f"voice_{idx+1}.mp3")
            await generate_edge_tts(scene_text, voice_audio, language)

            # Durée de l'audio
            scene_dur = max(duration, 5)
            try:
                probe = subprocess.check_output(f'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "{voice_audio}"', shell=True).decode().strip()
                scene_dur = max(scene_dur, math.ceil(float(probe)))
            except Exception:
                pass

            clip_out = os.path.join(work_dir, f"clip_{idx+1}.mp4")
            zoom_expr = "'min(zoom+0.0012,1.12)'" if idx % 2 == 0 else "'if(lte(zoom,1.0),1.12,max(1.0,zoom-0.0012))'"
            total_frames = int(scene_dur * 25)

            cmd = (
                f'ffmpeg -y -loop 1 -t {scene_dur} -i "{scene_img}" -i "{overlay_img}" -i "{voice_audio}" '
                f'-filter_complex "[0:v]scale={target_width*2}:{target_height*2},zoompan=z={zoom_expr}:d={total_frames}:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s={target_width}x{target_height}:fps=25[z];[z][1:v]overlay=0:0[v]" '
                f'-map "[v]" -map 2:a -c:v libx264 -preset veryfast -crf {crf} -maxrate {maxrate} -bufsize {bufsize} -pix_fmt yuv420p '
                f'-c:a aac -b:a 96k -ar 44100 -shortest "{clip_out}" -loglevel error'
            )
            subprocess.run(cmd, shell=True, check=True)
            scene_clips.append(clip_out)

            prog = 45 + int(((idx + 1) / len(scene_texts)) * 45)
            await update_turso_task(task_id, {
                "progress": prog,
                "step": f"rendered_scene_{idx+1}",
                "message": f"Scène {idx+1}/{len(scene_texts)} compilée..."
            })

        # 4. Assemblage final
        concat_txt = os.path.join(work_dir, "concat.txt")
        with open(concat_txt, "w") as f:
            for c in scene_clips:
                f.write(f"file '{c}'\n")

        final_mp4 = os.path.join(OUTPUTS_DIR, f"{task_id}.mp4")
        concat_cmd = f'ffmpeg -y -f concat -safe 0 -i "{concat_txt}" -c copy -movflags +faststart "{final_mp4}" -loglevel error'
        subprocess.run(concat_cmd, shell=True, check=True)

        final_dur = sum([duration] * len(scene_texts))
        try:
            probe = subprocess.check_output(f'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "{final_mp4}"', shell=True).decode().strip()
            final_dur = float(probe)
        except Exception:
            pass

        # URL publique de la vidéo
        video_download_url = f"{BASE_URL}/download/{task_id}" if BASE_URL else f"https://magiclight-api.vercel.app/stanleystawa/download?task_id={task_id}"

        await update_turso_task(task_id, {
            "status": "completed",
            "progress": 100,
            "step": "finished",
            "message": "Film IA finalisé avec succès !",
            "video_url": video_download_url,
            "duration": final_dur,
            "scenes_count": len(scene_texts)
        })
        logger.info(f"🎉 Rendu terminé avec succès pour {task_id} ({final_dur:.1f}s) !")

    except Exception as err:
        logger.error(f"❌ Erreur rendu {task_id}: {err}")
        # Remboursement automatique
        try:
            task_rows = await execute_turso("SELECT user_key, credits_deducted, refunded FROM video_tasks WHERE task_id = ?;", [task_id])
            if task_rows and task_rows[0].get("user_key") and int(task_rows[0].get("refunded", 0)) != 1:
                refund_amt = int(task_rows[0].get("credits_deducted", 0))
                if refund_amt > 0:
                    await execute_turso("UPDATE users SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP WHERE api_key = ?;", [refund_amt, task_rows[0]["user_key"]])
                    await execute_turso("UPDATE video_tasks SET refunded = 1 WHERE task_id = ?;", [task_id])
        except Exception as e:
            logger.warning(f"Refund error: {e}")

        await update_turso_task(task_id, {
            "status": "failed",
            "progress": 0,
            "step": "failed",
            "message": f"Échec du rendu ({str(err)}). Vos crédits ont été remboursés.",
            "error": str(err)
        })
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# ==========================================
# 6. Endpoints FastAPI
# ==========================================
class RenderRequest(BaseModel):
    task_id: str
    prompt: str
    initial_image: Optional[str] = ""
    sections: Optional[int] = 6
    quality: Optional[str] = "medium"
    duration: Optional[int] = 10
    ratio: Optional[str] = "1"
    language: Optional[str] = "french"


@app.get("/")
def home():
    return HTMLResponse("""
    <!DOCTYPE html>
    <html>
    <head><title>Stanley Video Engine Worker</title><style>body{background:#0b0e14;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:8px;}</style></head>
    <body>
        <h2 style="color:#7cf0c4;margin:0;">★ Stanley Video Engine Worker v2.0</h2>
        <p style="color:#8b949e;margin:0;">Micro-service FFmpeg + Edge-TTS + Turso Database 100% Opérationnel.</p>
    </body>
    </html>
    """)


@app.get("/health")
def health():
    return {"status": "ok", "service": "stanley-video-worker", "uptime": "active"}


@app.post("/render")
async def trigger_render(req: RenderRequest, bg_tasks: BackgroundTasks):
    """Déclenche un montage vidéo en arrière-plan sans bloquer la requête."""
    bg_tasks.add_task(
        render_video_pipeline,
        task_id=req.task_id,
        prompt=req.prompt,
        initial_image=req.initial_image or "",
        sections=req.sections or 6,
        quality=req.quality or "medium",
        duration=req.duration or 10,
        ratio=req.ratio or "1",
        language=req.language or "french"
    )
    return JSONResponse({
        "status": "queued",
        "task_id": req.task_id,
        "message": "Rendu vidéo lancé en tâche de fond sur le worker FFmpeg."
    })


@app.get("/download/{task_id}")
def download_video(task_id: str):
    """Sert le fichier MP4 généré."""
    mp4_path = os.path.join(OUTPUTS_DIR, f"{task_id}.mp4")
    if not os.path.exists(mp4_path):
        raise HTTPException(status_code=404, detail="Vidéo en cours de traitement ou inexistante.")
    return FileResponse(mp4_path, media_type="video/mp4", filename=f"{task_id}.mp4")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
