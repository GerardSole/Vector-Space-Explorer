# 🌌 Vector Space Explorer

**An interactive 3D playground for understanding how vector databases and semantic search actually work — built with vanilla JavaScript and Three.js, zero frameworks, zero build step.**

![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat-square&logo=three.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![Cohere](https://img.shields.io/badge/Cohere-embed--multilingual--v3.0-39594A?style=flat-square)
![No Build Step](https://img.shields.io/badge/build-none-success?style=flat-square)

![Demo](demo.gif)
<!-- 🎬 Add a screen recording here: insert/search/delete a word and orbit the camera around the space. -->

---

## What is this?

**Vector Space Explorer** is a self-contained 3D application that shows how a vector database works — and lets you *see* it happening in real time, instead of just reading about it.

Every word you insert gets converted into a **real 1024-dimensional embedding** by Cohere's `embed-multilingual-v3.0` model (optimized for Spanish), then **reduced to 3D via PCA** so it can be placed in the scene. Words with related meaning cluster together and connect with glowing lines. As you insert more words, the whole space reorganizes smoothly — the geometry is semantics made visible.

A left-hand console — styled like a SQL/terminal client — lets you `INSERT`, `SEARCH` and `DELETE` vectors exactly like you would against a real vector database, while an educational layer (hover tooltips, a "what just happened" panel, an onboarding overlay) explains the underlying concept in plain language as it happens.

No React, no Vue, no bundler, no `npm install`. Just HTML, CSS, and ES modules — Three.js is the only frontend dependency, loaded straight from a CDN. The Cohere API key never touches the browser: all embedding calls go through a Vercel serverless function that acts as a secure proxy.

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
               │ POST /api/embed
               │ { text: "palabra" }
┌──────────────▼──────────────┐
│    Vercel Serverless Fn      │
│    api/embed.js              │
│    (secure proxy — API key   │
│     never sent to browser)   │
└──────────────┬──────────────┘
               │ POST /v2/embed
               │ Authorization: Bearer ***
┌──────────────▼──────────────┐
│    Cohere API                │
│    embed-multilingual-v3.0   │
│    1024-dimensional output   │
└─────────────────────────────┘
```

`ui.js` and `scene.js` never call into each other directly — they communicate exclusively through `CustomEvent`s on `window`, keeping the DOM/UI layer and the Three.js/3D layer fully decoupled.

## Concepts demonstrated

| Concept | How it shows up in this project |
|---|---|
| **Vector embeddings** | Words inserted via the console get real 1024-dim embeddings from Cohere's multilingual model. The 24 background words use a fixed artistic layout; user-inserted words use genuine semantic vectors. |
| **Dimensionality reduction** | PCA (implemented from scratch, no libraries) reduces Cohere's 1024-dim output to 3D for rendering. The Gram-matrix dual approach runs in <5 ms even with 100+ words. Each new insertion triggers a smooth 800 ms repositioning of all real-embedding words. |
| **Similarity search** | `SEARCH` finds the *k* nearest words by Euclidean distance in 3D, highlights them, and ranks results with a visual distance bar — the same core idea behind semantic search. |
| **Vector databases** | The left panel mirrors the basic CRUD surface of a vector DB: `INSERT INTO vectors`, `SEARCH similar`, `DELETE vector` — complete with an operation log and a live vector count, so the mental model maps directly onto tools like Pinecone, Qdrant, or pgvector. |
| **Secure API proxy** | The Cohere API key lives only in a Vercel environment variable. The browser calls `/api/embed`; the serverless function adds the key and forwards the request. The key is never exposed to the client. |
| **Real-time 3D** | Every operation has an immediate animated consequence: inserted points burst into existence, deleted points implode, searches send a visible pulse, and PCA repositioning flies all words to their new semantic positions simultaneously. |

## How to run

### Local (without Cohere embeddings)

This project uses native ES modules and an `importmap`, which browsers refuse to load over `file://`. You need a local static server:

```bash
# Python (already on most systems)
python -m http.server 8080

# or Node.js
npx serve .
```

Open **http://localhost:8080**. Without a running Vercel Function, inserts fall back to a deterministic 6-value simulated vector — the 3D layout and all UI features still work.

## Project structure

```
vector-space-explorer/
├── index.html           # Two-panel layout + importmap (Three.js from CDN)
├── vercel.json          # Minimal Vercel v2 config (static + functions)
├── package.json         # engines: node >=18 (for native fetch in the function)
├── api/
│   └── embed.js          # Vercel Function — secure Cohere proxy
├── css/
│   └── style.css          # GitHub-dark theme, CSS variable scoping, animations
├── js/
│   ├── scene.js            # Three.js setup, manual orbit camera, raycasting, render loop
│   ├── particles.js         # Ambient particle field (custom shader) + insert/search/delete FX
│   ├── words.js             # Word registry, 3D visuals (glow + label), connections, PCA animation
│   ├── pca.js               # PCA from scratch — Gram matrix, power iteration, sign normalization
│   └── ui.js                 # Console panel: INSERT/SEARCH/DELETE, Cohere calls, PCA wiring, onboarding
└── README.md
```

## Next steps

- ✅ **Real embeddings** — Cohere `embed-multilingual-v3.0` via a secure Vercel Function proxy
- ✅ **Dimensionality reduction** — PCA from scratch (Gram matrix dual approach, <5 ms at 100 words)
- ⬜ **Real vector database** — swap the in-memory registry for Qdrant, Pinecone, or pgvector so `INSERT`/`SEARCH`/`DELETE` hit a real index
- ⬜ **Better projection** — t-SNE or UMAP instead of PCA for non-linear structure preservation
- ⬜ **Persistence** — save/restore vectors across sessions (everything resets on reload)

## Author

**Gerard Solé**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/gerard-sol%C3%A9-catal%C3%A0-b11b98256/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/GerardSole)
