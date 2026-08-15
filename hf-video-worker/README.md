---
title: Stanley Video Engine Worker
emoji: 🎬
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# ★ Stanley Video Engine Worker (Hugging Face Space)

Micro-service de montage vidéo multi-scènes pour **MagicLight AI / Stanley Studio**.

### Caractéristiques
- **100% Gratuit à vie** (Tourne sur le CPU Basic gratuit de Hugging Face avec 16 Go de RAM).
- **FFmpeg natif** pour l'assemblage cinématique, sous-titres et compression H.264 ultra-compacte.
- **Edge-TTS** pour la synthèse vocale neuronale en français et anglais.
- **Filigrane officiel `★ Stanley stawa`** positionné avec précision via Pillow.
- **Synchronisation temps réel avec Turso libSQL Database**.

---

## 🚀 Déploiement en 2 étapes sur Hugging Face

1. **Créer un Space sur Hugging Face** :
   - Allez sur [huggingface.co/new-space](https://huggingface.co/new-space)
   - Donnez un nom (ex: `stanley-video-worker`)
   - Choisissez **Docker** (Blank)
   - Cliquez sur **Create Space**

2. **Uploader les fichiers** :
   - Déposez les 3 fichiers : `Dockerfile`, `requirements.txt`, `app.py`
   - Dans les paramètres du Space (**Settings** -> **Variables and secrets**), ajoutez :
     - `TURSO_DATABASE_URL` = `https://magicligth-stanleystawa354.aws-eu-west-1.turso.io`
     - `TURSO_AUTH_TOKEN` = *(Votre clé Turso JWT)*
   - Dans votre projet Vercel (**Environment Variables**), ajoutez :
     - `HF_WORKER_URL` = `https://<votre-nom-hf>-stanley-video-worker.hf.space`
