# 🎬 MagicLight AI Serverless API — Vercel & Turso DB

API REST haute performance prête pour **Vercel** permettant de générer des **vidéos IA complètes sans filigrane**, des **images**, des **retouches**, des **scénarios (10-15 scènes)** et de la **synthèse vocale**, propulsée par **MagicLight AI** et synchronisée sur **Turso Database**.

---

## 🗄️ Base de Données & Gestion Automatique des Comptes

* **Base de données :** `libsql://magicligth-stanleystawa354.aws-eu-west-1.turso.io`
* **Table :** `magiclight_accounts`
* **Auto-Nettoyage :** Dès qu'un compte consomme tous ses crédits (**0 crédit restant**), il est **automatiquement supprimé** de la base Turso.
* **Auto-Refill :** Si le pool de comptes devient faible, l'API génère automatiquement une nouvelle boîte e-mail temporaire (`https://vercel-text-api-zeta.vercel.app/stanleystawa/tempmail`), valide l'OTP MagicLight et enregistre le nouveau compte avec ses **800 crédits** dans Turso.

---

## 🌐 Endpoints API (Compatibles GET Query & POST JSON)

### 1. Génération de Vidéo Cloud (100% sans filigrane)
* **Endpoint :** `GET/POST /stanleystawa/video`
* **Exemple avec redirection MP4 directe :**
  ```
  https://vercel-animate-api.vercel.app/stanleystawa/video?prompt=Un+petit+chaton+jouant+dans+un+jardin&mode=expand&format=mp4
  ```
* **Paramètres :**
  * `prompt` ou `text` *(Requis)* : Description ou idée de l'histoire.
  * `mode` :
    * `expand` *(Défaut)* : Développe l'histoire en scénario multi-scènes (10-15 scènes).
    * `direct` : Utilise exactement le texte fourni sans modification.
  * `format` : `mp4` *(redirige vers le MP4)* ou `json` *(renvoie l'objet JSON)*.
  * `language` : `french`, `english`, `spanish` (défaut : `french`).
  * `ratio` : `1` (16:9) ou `2` (9:16 vertical).
  * `noWatermark` : `true` (défaut : `true` pour suppression du logo).

---

### 2. Génération d'Image
* **Endpoint :** `GET/POST /stanleystawa/image`
* **Exemple :**
  ```
  https://vercel-animate-api.vercel.app/stanleystawa/image?prompt=Un+dragon+cyberpunk+8k&ratio=1
  ```
* **Paramètres :** `prompt`, `styleId` (défaut `5001`), `ratio`, `format` (`json` ou `image`).

---

### 3. Retouche d'Image
* **Endpoint :** `GET/POST /stanleystawa/edit`
* **Paramètres :** `imageUrl`, `prompt`.

---

### 4. Expansion de Scénario IA
* **Endpoint :** `GET/POST /stanleystawa/story`
* **Exemple :**
  ```
  https://vercel-animate-api.vercel.app/stanleystawa/story?idea=Un+robot+qui+decouvre+la+nature&language=french
  ```

---

### 5. Synthèse Vocale IA (MagicLight TTS)
* **Endpoint :** `GET/POST /stanleystawa/voice`
* **Exemple :**
  ```
  https://vercel-animate-api.vercel.app/stanleystawa/voice?text=Bienvenue+sur+notre+service&format=audio
  ```

---

### 6. Consultation des Comptes et Crédits (Turso DB)
* **Endpoint :** `GET /stanleystawa/accounts`
* Affiche tous les comptes actifs et le solde de crédits cumulé dans Turso.

---

### 7. Rechargement Immédiat (Auto-Refill)
* **Endpoint :** `GET /stanleystawa/refill`
* Force la création immédiate d'un nouveau compte MagicLight et son ajout dans Turso.
