"""
Stanley Video Engine Worker — Root Entrypoint for Render / Koyeb / Docker
FastAPI Service + FFmpeg + Edge-TTS + Watermark ★ Stanley stawa + Turso libSQL
"""

import os
import sys

# Import app from hf-video-worker or run directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "hf-video-worker"))

try:
    from app import app
except Exception:
    import importlib.util
    spec = importlib.util.spec_from_file_location("hf_app", os.path.join(os.path.dirname(__file__), "hf-video-worker", "app.py"))
    hf_app = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hf_app)
    app = hf_app.app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
