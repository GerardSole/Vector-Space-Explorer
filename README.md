# 🌌 Vector Space Explorer

**An interactive 3D playground for understanding how vector databases and semantic search actually work — built with vanilla JavaScript and Three.js, zero frameworks, zero build step.**

![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat-square&logo=three.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![No Build Step](https://img.shields.io/badge/build-none-success?style=flat-square)

![Demo](demo.gif)
<!-- 🎬 Add a screen recording here: insert/search/delete a word and orbit the camera around the space. -->

---

## What is this?

**Vector Space Explorer** is a small, self-contained 3D application that simulates how a vector database works — and lets you *see* it happening in real time, instead of just reading about it.

Every word you insert becomes a point of light positioned in 3D space. Words with related meaning cluster together and connect with glowing lines. A left-hand console — styled like a SQL/terminal client — lets you `INSERT`, `SEARCH` and `DELETE` vectors exactly like you would against a real vector database, while an educational layer (hover tooltips, a "what just happened" panel, an onboarding overlay) explains the underlying concept in plain language as it happens.

It started as a small visualization exercise and grew, iteration by iteration, into a fairly complete demo of: 3D rendering from scratch (manual camera/orbit controls, no `OrbitControls` import), a tiny custom particle/shader system, an event-driven architecture connecting the UI and the 3D scene, and UX details aimed at making an abstract ML concept tangible for a non-technical audience.

No React, no Vue, no bundler, no `npm install`. Just HTML, CSS, and ES modules — Three.js itself is the only dependency, loaded straight from a CDN.

## Concepts demonstrated

| Concept | How it shows up in this project |
|---|---|
| **Vector embeddings** | Each word is assigned a vector. To keep the visualization honest and inspectable, this demo uses the word's actual 3D position as its "embedding" (plus a small deterministic decorative vector shown in the UI) — a deliberate simplification of what a real embedding model produces. |
| **Similarity search** | `SEARCH` finds the *k* nearest words by real Euclidean distance in the 3D space, highlights them, and ranks results with a visual distance bar — the same core idea behind semantic search, minus the neural network. |
| **Vector databases** | The left panel mirrors the basic CRUD surface of a vector DB: `INSERT INTO vectors`, `SEARCH similar`, `DELETE vector` — complete with an operation log and a live vector count, so the mental model maps directly onto tools like Pinecone, Qdrant, or pgvector. |
| **Real-time 3D visualization** | Every operation has an immediate, animated 3D consequence: inserted points burst into existence, deleted points implode and fall, searches send a visible pulse through the space — so the data structure stops being an abstraction and becomes something you can watch change. |

## How to run

This project uses native ES modules and an `importmap`, which browsers refuse to load over the `file://` protocol (CORS). Opening `index.html` by double-clicking it **will not work** — you need a tiny local static server, which takes one command and no installation beyond what you likely already have:

```bash
# Python (already installed on most systems)
python -m http.server 8080

# or Node.js
npx serve .
```

Then open **http://localhost:8080** in your browser.

## Project structure

```
vector-space-explorer/
├── index.html          # Two-panel layout (Vector DB console + 3D canvas), font/CDN imports
├── css/
│   └── style.css        # Terminal-inspired theme: colors, layout, collapsible panels, animations
├── js/
│   ├── scene.js          # Three.js setup, manual orbit camera, raycasting, render loop, visual effects wiring
│   ├── particles.js       # Ambient background particle field (custom shader) + insert/search/delete effects
│   ├── words.js           # Word/vector data model, 3D word representation (glow + label), connections graph
│   └── ui.js               # Left panel: INSERT/SEARCH/DELETE console, op log, tooltips' data, onboarding
└── README.md
```

`ui.js` and `scene.js` never call into each other directly — they communicate exclusively through `CustomEvent`s on `window`, which keeps the DOM/UI layer and the Three.js/3D layer fully decoupled.

## Next steps

This project is intentionally a *simulation* of a vector database — the "embeddings" are simplified so the math stays visualizable. The natural next iterations would be:

- **Plug in real embeddings** — call the OpenAI API (`text-embedding-3-small` or similar) to generate genuine high-dimensional vectors for inserted words, instead of the deterministic placeholder used now.
- **Dimensionality reduction for visualization** — real embeddings live in 384+ dimensions; reducing them to 3D for rendering would need PCA, t-SNE, or UMAP rather than the fixed zone layout used here.
- **Back it with a real vector database** — swap the in-memory word registry for an actual store like Qdrant, Pinecone, or pgvector, so `INSERT`/`SEARCH`/`DELETE` hit a real index instead of a JS `Map`.
- **Persistence** — save/restore the inserted vectors across sessions (currently everything resets on reload).

## Author

**Gerard Solé Català**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/gerard-sol%C3%A9-catal%C3%A0-b11b98256/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/GerardSole)
