# 🌌 Vector Space Explorer

**An interactive 3D playground for understanding how vector databases and semantic search actually work — built with vanilla JavaScript and Three.js, zero frameworks, zero build step.**

![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat-square&logo=three.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![Qdrant](https://img.shields.io/badge/Qdrant-Cloud-DC244C?style=flat-square)
![Cohere](https://img.shields.io/badge/Cohere-embed--multilingual--v3.0-39594A?style=flat-square)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?style=flat-square&logo=render&logoColor=black)

![Demo](demo.gif)
<!-- 🎬 Add a screen recording here: insert/search/delete a word and orbit the camera around the space. -->

---

## What is this?

**Vector Space Explorer** is a self-contained 3D application that shows how a vector database works — and lets you *see* it happening in real time, instead of just reading about it.

Every word you insert gets converted into a **real 1024-dimensional embedding** by Cohere's `embed-multilingual-v3.0` model (optimized for Spanish), stored in **Qdrant Cloud**, and **reduced to 3D via PCA** so it can be placed in the scene. Words with related meaning cluster together and connect with glowing lines. As you insert more words, the whole space reorganizes smoothly — the geometry is semantics made visible.

A left-hand console — styled like a SQL/terminal client — lets you `INSERT`, `SEARCH` and `DELETE` vectors exactly like you would against a real vector database, while an educational layer explains the underlying concept in plain language as it happens.

No React, no Vue, no bundler, no `npm install`. The frontend is pure HTML, CSS, and ES modules. All embedding calls and vector operations go through a FastAPI backend deployed on Render; the Cohere API key never touches the browser.

---

## Architecture

```
┌─────────────────────────────┐
│         Browser             │
│                             │
│  Three.js 3D scene          │
│  ┌─────────┐  ┌──────────┐  │
│  │ scene.js│  │  ui.js   │  │
│  └────┬────┘  └────┬─────┘  │
│       └─────┬──────┘        │
│         CustomEvents        │
│          (decoupled)        │
│                             │
│  words.js ──► pca.js        │
│  (registry + PCA layout)    │
└──────────────┬──────────────┘
               │ REST API
               │ /api/vectors/*
┌──────────────▼──────────────┐
│    FastAPI (Render)          │
│    backend/main.py           │
│    ┌──────────┐              │
│    │ /insert  │ ─── Cohere ──►  embed-multilingual-v3.0
│    │ /search  │               (1024-dim embeddings)
│    │ /delete  │
│    │ /list    │ ─── Qdrant ──►  Cloud vector index
│    │ /seed    │               (cosine similarity)
│    └──────────┘
└─────────────────────────────┘
```

**Simplified view:**

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │────▶│   FastAPI    │────▶│   Qdrant    │
│  (Vercel)   │     │   (Render)   │     │   Cloud     │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │    Cohere    │
                    │  Embeddings  │
                    └──────────────┘
```

`ui.js` and `scene.js` never call into each other directly — they communicate exclusively through `CustomEvent`s on `window`, keeping the DOM/UI layer and the Three.js/3D layer fully decoupled.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Three.js 0.160, vanilla JS ES modules | 3D scene, UI console |
| Backend | FastAPI + Python 3.11 | REST API, business logic |
| Vector DB | Qdrant Cloud (free tier) | Persistent vector storage + cosine similarity search |
| Embeddings | Cohere `embed-multilingual-v3.0` | 1024-dim multilingual vectors |
| Frontend hosting | Vercel | Static site deployment |
| Backend hosting | Render (free tier, Docker) | FastAPI container |
| Local dev | Docker Compose | Qdrant + backend together |

---

## Concepts demonstrated

| Concept | How it shows up in this project |
|---|---|
| **Vector embeddings** | Words inserted via the console get real 1024-dim embeddings from Cohere's multilingual model, stored durably in Qdrant. |
| **Dimensionality reduction** | PCA (implemented from scratch, no libraries) reduces Cohere's 1024-dim output to 3D for rendering. The Gram-matrix dual approach runs in <5 ms even with 100+ words. Each new insertion triggers a smooth 800 ms repositioning of all words. |
| **Similarity search** | `SEARCH` queries Qdrant's cosine similarity index, highlights the nearest-neighbor words in the 3D scene, and ranks results with a visual distance bar. |
| **Vector databases** | The left panel mirrors the basic CRUD surface of a vector DB: `INSERT INTO vectors`, `SEARCH similar`, `DELETE vector` — complete with an operation log and a live vector count. |
| **Persistence** | All vectors are stored in Qdrant Cloud. On page reload, `listVectors()` fetches the current state and the scene is reconstructed exactly as left. |
| **Secure API proxy** | The Cohere API key lives only in Render environment variables. The browser never sees it. |
| **Real-time 3D** | Every operation has an immediate animated consequence: inserted points burst into existence, deleted points implode, searches send a visible pulse, and PCA repositioning flies all words to their new semantic positions simultaneously. |

---

## Local Development

### Prerequisites

- Docker Desktop
- A [Cohere API key](https://cohere.com) (free tier available)

### Setup

```bash
git clone https://github.com/GerardSole/vector-space-explorer.git
cd vector-space-explorer

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env and add your COHERE_API_KEY

# Start Qdrant + FastAPI backend
docker compose up
```

The backend starts on **http://localhost:8000** and seeds 25 Spanish words into Qdrant automatically on first run (idempotent — safe to restart).

Open the frontend at `frontend/index.html` via a local static server:

```bash
# Python
python -m http.server 8080 --directory frontend

# or Node.js
npx serve frontend
```

Then open **http://localhost:8080**.

---

## Project Structure

```
vector-space-explorer/
├── frontend/                    # Static site (deployed to Vercel)
│   ├── index.html               # Two-panel layout + Three.js importmap
│   ├── css/
│   │   └── style.css            # GitHub-dark theme, CSS variables, animations
│   ├── js/
│   │   ├── api.js               # Centralized backend API calls
│   │   ├── scene.js             # Three.js setup, orbit camera, raycasting, render loop
│   │   ├── particles.js         # Ambient particle field + insert/search/delete FX
│   │   ├── words.js             # Word registry, 3D visuals (glow + label), connections
│   │   ├── pca.js               # PCA from scratch — Gram matrix, power iteration
│   │   └── ui.js                # Console panel: INSERT/SEARCH/DELETE, PCA wiring, onboarding
│   └── api/
│       └── embed.js             # Legacy Vercel Function (kept for Vercel deploy)
├── backend/                     # FastAPI service (deployed to Render via Docker)
│   ├── main.py                  # App entry point, CORS, lifespan (seed on startup)
│   ├── config.py                # Env vars: Cohere, Qdrant, CORS, PORT
│   ├── models.py                # Pydantic request/response models
│   ├── seed.py                  # Idempotent dataset seed (25 Spanish words)
│   ├── routers/
│   │   ├── vectors.py           # INSERT, SEARCH, DELETE, LIST, INFO, SEED endpoints
│   │   └── embed.py             # POST /api/embed — raw Cohere proxy
│   ├── services/
│   │   ├── cohere.py            # Async Cohere client
│   │   └── qdrant.py            # Async Qdrant client + collection operations
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml           # Qdrant + backend for local development
├── render.yaml                  # Render deployment spec
├── DEPLOY.md                    # Step-by-step production deploy guide
└── README.md
```

---

## API Reference

Base URL: `https://vector-space-explorer.onrender.com` (production) or `http://localhost:8000` (local)

### POST `/api/vectors/insert`

Embeds a word with Cohere and stores it in Qdrant.

**Body:**
```json
{ "word": "esperanza", "category": "emotion" }
```

**Response `201`:**
```json
{
  "word": "esperanza",
  "category": "emotion",
  "vector": [0.021, -0.043, ...],
  "vector_preview": [0.021, -0.043, 0.017, -0.009, 0.031, -0.028],
  "id": 4823901234567890,
  "dimensions": 1024
}
```

---

### POST `/api/vectors/search`

Finds the *k* most similar words by cosine similarity.

**Body:**
```json
{ "word": "amor", "k": 5 }
```

**Response `200`:**
```json
[
  { "word": "esperanza", "category": "emotion", "score": 0.921, "distance": 0.079 },
  { "word": "alegría",   "category": "emotion", "score": 0.887, "distance": 0.113 }
]
```

---

### DELETE `/api/vectors/{word}`

Removes a word from Qdrant.

**Response `200`:**
```json
{ "success": true, "word": "tristeza" }
```

---

### GET `/api/vectors/list`

Returns all stored vectors (full 1024-dim vectors included for PCA reconstruction).

**Response `200`:**
```json
[
  {
    "word": "amor",
    "category": "emotion",
    "vector": [0.021, -0.043, ...],
    "vector_preview": [0.021, -0.043, 0.017, -0.009, 0.031, -0.028]
  }
]
```

---

### GET `/api/vectors/info`

Collection metadata.

**Response `200`:**
```json
{
  "total_vectors": 25,
  "collection_name": "vectors",
  "vector_size": 1024,
  "status": "ok"
}
```

---

### POST `/api/vectors/seed?force=false`

Re-runs the dataset seed. No-op if collection already has data. Pass `?force=true` to wipe and re-seed (useful for resetting the demo).

**Response `200`:**
```json
{ "inserted": 0, "message": "Colección ya tenía datos" }
```

---

## Environment Variables

| Variable | Service | Description |
|---|---|---|
| `COHERE_API_KEY` | Backend (Render) | Cohere API key — [get one free](https://cohere.com) |
| `QDRANT_URL` | Backend (Render) | Qdrant cluster URL, e.g. `https://<id>.cloud.qdrant.io` |
| `QDRANT_API_KEY` | Backend (Render) | Qdrant Cloud API key (not required for local Docker) |
| `QDRANT_COLLECTION` | Backend (Render) | Collection name — default `vectors` |
| `CORS_ORIGINS` | Backend (Render) | Allowed origins, comma-separated or `*` — default `*` |
| `PORT` | Backend (Render) | Injected automatically by Render — do not set manually |

Copy `backend/.env.example` for local development:

```bash
cp backend/.env.example backend/.env
```

---

## Next Steps

- ✅ **Real embeddings** — Cohere `embed-multilingual-v3.0` via FastAPI proxy (1024 dims, Spanish-optimized)
- ✅ **Dimensionality reduction** — PCA from scratch (Gram matrix dual approach, <5 ms at 100 words)
- ✅ **Real vector database** — Qdrant Cloud via FastAPI on Render; `INSERT`/`SEARCH`/`DELETE` hit a real index with cosine similarity
- ✅ **Persistence** — vectors stored in Qdrant Cloud, scene reconstructed on every reload via `listVectors()`
- ⬜ **Better projection** — t-SNE or UMAP instead of PCA for non-linear structure preservation
- ⬜ **Auth** — rate-limit the public API or add a simple token so the demo can't be abused

---

## Author

**Gerard Solé**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/gerard-sol%C3%A9-catal%C3%A0-b11b98256/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/GerardSole)
