/**
 * ui.js — panel izquierdo "Vector DB": una consola estilo SQL/terminal
 * para operar sobre el espacio vectorial (INSERT / SEARCH / DELETE),
 * con un log de operaciones tipo terminal en el footer.
 *
 * Construye TODO el contenido de #dbPanel por JS (index.html solo
 * provee el contenedor vacío) y se comunica con scene.js mediante
 * CustomEvents en window (ver cabecera de scene.js para el contrato):
 *   - escucha "vse:word-selected"  (click en un punto 3D) → loguea +
 *     pide a la cámara que vuele hacia esa palabra (vse:focus-word)
 *
 * No toca Three.js directamente: usa las funciones de representación
 * de words.js (addWordToScene / removeWordFromScene / highlightWords /
 * resetHighlights) para que INSERT/SEARCH/DELETE tengan efecto real en
 * la escena 3D, no solo en este panel.
 */

import {
  CATEGORY_COLORS,
  addWordToScene,
  removeWordFromScene,
  highlightWords,
  resetHighlights,
  getInsertPosition,
  getSimulatedVector,
  repositionWord,
  makeVector3,
} from "./words.js";
import { pca, normalizeProjection } from "./pca.js";
import { insertWord, searchSimilar, deleteWord, listVectors } from "./api.js";

const dbPanel = document.getElementById("dbPanel");
const CATEGORIES = Object.keys(CATEGORY_COLORS); // ["emotion","nature","animal","object","person","custom"]
const LOG_LIMIT = 5;

// ---------------------------------------------------------------- markup

dbPanel.innerHTML = `
  <header class="db-header">
    <div class="db-header__title">
      <span class="db-header__dot"></span>
      <h1>Vector DB</h1>
    </div>
    <span class="db-header__badge" id="vectorCount">0 vectors</span>
  </header>

  <div class="db-body">
    <section class="db-section">
      <h2 class="db-section__title">INSERT</h2>
      <input type="text" id="insertWord" class="terminal-input" placeholder="palabra…" autocomplete="off">
      <select id="insertCategory" class="terminal-select">
        ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
      </select>
      <div class="vector-preview" id="insertVectorPreview">[ ]</div>
      <p class="edu-note">
        El vector real lo genera <code>Cohere embed-multilingual-v3.0</code> (1024 dimensiones),
        optimizado para español. Si no hay conexión con la API, se usa un vector determinista de
        6 valores como fallback.
      </p>
      <button class="terminal-btn" id="insertBtn"><span class="terminal-btn__kw">INSERT INTO</span> vectors</button>
    </section>

    <section class="db-section">
      <h2 class="db-section__title">SEARCH</h2>
      <input type="text" id="searchWord" class="terminal-input" placeholder="palabra…" autocomplete="off">
      <div class="slider-row">
        <label for="kSlider">k = <span id="kValue">4</span></label>
        <input type="range" id="kSlider" min="1" max="8" value="4">
      </div>
      <button class="terminal-btn" id="searchBtn"><span class="terminal-btn__kw">SEARCH</span> similar</button>
      <ul class="search-results" id="searchResults"></ul>
    </section>

    <section class="db-section">
      <h2 class="db-section__title">DELETE</h2>
      <select id="deleteWord" class="terminal-select"></select>
      <button class="terminal-btn terminal-btn--danger" id="deleteBtn"><span class="terminal-btn__kw">DELETE</span> vector</button>
    </section>
  </div>

  <footer class="db-log" id="opLog"></footer>

  <section class="edu-panel" id="eduPanel">
    <button class="edu-panel__toggle" id="eduToggle" aria-expanded="true">
      <span class="edu-panel__toggle-label">¿Qué acaba de pasar?</span>
      <span class="edu-panel__toggle-icon" id="eduToggleIcon">▾</span>
    </button>
    <div class="edu-panel__body" id="eduBody">
      <span class="edu-panel__icon" id="eduIcon">💡</span>
      <p class="edu-panel__text" id="eduText">
        Inserta, busca o elimina una palabra (o haz click sobre un punto en la escena) para ver aquí
        una explicación sencilla de lo que ocurre por debajo.
      </p>
    </div>
  </section>
`;

// ---------------------------------------------------------------- referencias

const vectorCountEl = document.getElementById("vectorCount");

const insertWordEl = document.getElementById("insertWord");
const insertCategoryEl = document.getElementById("insertCategory");
const insertPreviewEl = document.getElementById("insertVectorPreview");
const insertBtn = document.getElementById("insertBtn");

const searchWordEl = document.getElementById("searchWord");
const kSliderEl = document.getElementById("kSlider");
const kValueEl = document.getElementById("kValue");
const searchBtn = document.getElementById("searchBtn");
const searchResultsEl = document.getElementById("searchResults");

const deleteWordEl = document.getElementById("deleteWord");
const deleteBtn = document.getElementById("deleteBtn");

const opLogEl = document.getElementById("opLog");

const eduToggleEl = document.getElementById("eduToggle");
const eduToggleIconEl = document.getElementById("eduToggleIcon");
const eduBodyEl = document.getElementById("eduBody");
const eduIconEl = document.getElementById("eduIcon");
const eduTextEl = document.getElementById("eduText");

// ---------------------------------------------------------------- "tabla" en memoria
//
// Arranca vacío; se rellena en initializeWordSpace() una vez que los
// embeddings reales de Cohere están listos y PCA ha calculado posiciones.
let rows = [];

function refreshVectorCount() {
  vectorCountEl.textContent = `${rows.length} vectors`;
}

function refreshDeleteOptions() {
  deleteWordEl.innerHTML = rows
    .slice()
    .sort((a, b) => a.word.localeCompare(b.word))
    .map((row) => `<option value="${row.word}">${row.word} (${row.category})</option>`)
    .join("");
}

// ---------------------------------------------------------------- log de operaciones

let logLines = [];

function log(html) {
  logLines.unshift(html);
  logLines = logLines.slice(0, LOG_LIMIT);
  opLogEl.innerHTML = logLines.map((line) => `<div class="db-log__line">${line}</div>`).join("");
}

const kw = (text) => `<span class="db-log__kw">${text}</span>`;

function logSuccess(verb, rest) {
  log(`<span class="db-log__ok">✓</span> ${kw(verb)} ${rest}`);
}

function logError(verb, rest) {
  log(`<span class="db-log__err">✗</span> ${kw(verb)} ${rest}`);
}

// ---------------------------------------------------------------- panel educativo
//
// Explica en lenguaje simple la última operación realizada — máximo 2
// líneas de texto, con un icono. setEducation() la llaman los handlers
// de INSERT/SEARCH/DELETE y el listener de selección 3D, así cambia
// automáticamente con cada acción.

const EDU_EXPLANATIONS = {
  insert: {
    icon: "➕",
    text: "Has convertido una palabra en un vector real de 1024 dimensiones generado por Cohere y lo has guardado en el índice, junto a las palabras semánticamente más parecidas.",
  },
  search: {
    icon: "🔍",
    text: "La IA ha comparado distancias en el espacio vectorial entre tu consulta y cada palabra guardada, y ha ordenado los resultados por cercanía.",
  },
  delete: {
    icon: "🗑️",
    text: "El vector ha sido eliminado del índice: ya no se puede buscar ni aparece conectado a otras palabras.",
  },
  select: {
    icon: "👁️",
    text: "Has inspeccionado un vector existente: su posición en el espacio refleja lo parecido que es a las demás palabras.",
  },
};

function setEducation(kind) {
  const info = EDU_EXPLANATIONS[kind];
  if (!info) return;
  eduIconEl.textContent = info.icon;
  eduTextEl.textContent = info.text;
}

eduToggleEl.addEventListener("click", () => {
  const collapsed = eduBodyEl.classList.toggle("is-collapsed");
  eduToggleEl.setAttribute("aria-expanded", String(!collapsed));
  eduToggleIconEl.textContent = collapsed ? "▸" : "▾";
});

// ---------------------------------------------------------------- PCA — reposicionamiento semántico
//
// Se ejecuta cada vez que hay ≥ 2 palabras con embeddings reales de
// Cohere (1024 dims). Las palabras con vectores simulados (palabras
// sembradas, sin clave API) no participan y conservan sus posiciones
// artísticas originales.
//
// prevPCAPositions guarda la última proyección por palabra para alinear
// los signos entre llamadas sucesivas (la iteración potencia puede
// converger a ±v; el signo canónico de pca.js es consistente pero la
// escala varía, y la alineación con la posición anterior evita "saltos
// de espejo" al insertar o eliminar palabras).

const prevPCAPositions = new Map(); // word → [x, y, z] de la última proyección

function applyPCA(rows) {
  const realRows = rows.filter((r) => r.vector && r.vector.length === 1024);
  if (realRows.length < 2) return;

  let coords = pca(realRows.map((r) => r.vector), 3);

  // Alinear signos con posiciones previas para evitar flips de espejo
  for (let dim = 0; dim < 3; dim++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < realRows.length; i++) {
      const prev = prevPCAPositions.get(realRows[i].word);
      if (prev) { corr += coords[i][dim] * prev[dim]; count++; }
    }
    if (count > 0 && corr < 0) {
      for (let i = 0; i < coords.length; i++) coords[i][dim] = -coords[i][dim];
    }
  }

  coords = normalizeProjection(coords, 7);

  for (let i = 0; i < realRows.length; i++) {
    const row = realRows[i];
    const [x, y, z] = coords[i];
    prevPCAPositions.set(row.word, [x, y, z]);
    // Actualiza la posición lógica de la fila (usada por SEARCH y DELETE-fx)
    row.position.set(x, y, z);
    repositionWord(row.word, row.position, 800);
  }
}

// ---------------------------------------------------------------- INSERT

function refreshInsertPreview() {
  const word = insertWordEl.value.trim().toLowerCase();
  insertPreviewEl.textContent = word ? `[${getSimulatedVector(word).join(", ")}]` : "[ ]";
}

insertWordEl.addEventListener("input", refreshInsertPreview);

insertBtn.addEventListener("click", async () => {
  const word = insertWordEl.value.trim().toLowerCase();
  const category = insertCategoryEl.value;

  if (!word) { logError("INSERT", "→ palabra vacía"); return; }
  if (rows.some((row) => row.word === word)) { logError("INSERT", `'${word}' → ya existe`); return; }

  insertBtn.disabled = true;
  insertBtn.innerHTML = '<span class="terminal-btn__kw">INSERT INTO</span> Generando vector…';
  insertPreviewEl.textContent = "Generando vector…";

  let result;
  try {
    result = await insertWord(word, category);
  } catch (e) {
    insertBtn.disabled = false;
    insertBtn.innerHTML = '<span class="terminal-btn__kw">INSERT INTO</span> vectors';
    insertPreviewEl.textContent = "[ ]";
    logError("INSERT", `'${word}' → ${e.message}`);
    return; // no añadir a escena si Qdrant no confirmó
  }

  insertBtn.disabled = false;
  insertBtn.innerHTML = '<span class="terminal-btn__kw">INSERT INTO</span> vectors';
  insertPreviewEl.textContent = `[${result.vector_preview.map((v) => v.toFixed(2)).join(", ")}…]`;

  const position = getInsertPosition(category);
  addWordToScene(word, position, category);
  rows.push({ word, category, position, vector: result.vector });

  applyPCA(rows);

  window.dispatchEvent(
    new CustomEvent("vse:insert-fx", { detail: { position, color: CATEGORY_COLORS[category] } })
  );

  refreshVectorCount();
  refreshDeleteOptions();
  logSuccess("INSERT", `'${word}' → vector[${result.dimensions}] guardado en Qdrant`);
  setEducation("insert");

  insertWordEl.value = "";
  refreshInsertPreview();
});

// ---------------------------------------------------------------- SEARCH

kSliderEl.addEventListener("input", () => {
  kValueEl.textContent = kSliderEl.value;
});

function renderSearchResults(results) {
  if (!results.length) {
    searchResultsEl.innerHTML = `<li class="search-results__empty">sin resultados</li>`;
    return;
  }

  // barra visual: proporcional a la proximidad relativa dentro de este
  // mismo resultado (el más cercano de los k siempre llena la barra)
  const maxDistance = Math.max(...results.map((r) => r.distance), 0.0001);

  searchResultsEl.innerHTML = results
    .map(({ row, distance }) => {
      const fillPct = Math.max(4, 100 * (1 - distance / maxDistance));
      return `
        <li class="search-results__item">
          <span class="search-results__swatch" style="background:${CATEGORY_COLORS[row.category]}"></span>
          <span class="search-results__word">${row.word}</span>
          <span class="search-results__bar"><span class="search-results__bar-fill" style="width:${fillPct}%"></span></span>
          <span class="search-results__distance">${distance.toFixed(3)}</span>
        </li>
      `;
    })
    .join("");
}

/** Promedio de varias posiciones {x,y,z} (no requiere THREE.Vector3). */
function centroidOf(positions) {
  const sum = positions.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 }
  );
  const n = positions.length;
  return { x: sum.x / n, y: sum.y / n, z: sum.z / n };
}

searchBtn.addEventListener("click", async () => {
  const query = searchWordEl.value.trim().toLowerCase();
  const k = Number(kSliderEl.value);

  if (!query) { logError("SEARCH", "→ palabra vacía"); return; }

  searchBtn.disabled = true;
  const t0 = performance.now();

  let apiResults;
  try {
    apiResults = await searchSimilar(query, k);
  } catch {
    // fallback: búsqueda local por distancia 3D si el backend no responde
    const target = rows.find((row) => row.word === query);
    if (!target) {
      renderSearchResults([]);
      logError("SEARCH", `'${query}' → not found`);
      searchBtn.disabled = false;
      return;
    }
    apiResults = rows
      .filter((row) => row !== target)
      .map((row) => ({ word: row.word, category: row.category, score: 0, distance: target.position.distanceTo(row.position) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  } finally {
    searchBtn.disabled = false;
  }

  const elapsedMs = Math.round(performance.now() - t0);

  // Adapta los resultados del backend al formato de renderSearchResults
  const results = apiResults.map((r) => ({
    row: { word: r.word, category: r.category },
    distance: r.distance,
  }));
  renderSearchResults(results);

  const allWords = [query, ...apiResults.map((r) => r.word)];
  highlightWords(allWords);

  // Efectos visuales usando posiciones locales de rows
  const targetRow = rows.find((row) => row.word === query);
  if (targetRow) {
    window.dispatchEvent(
      new CustomEvent("vse:search-fx", {
        detail: { position: targetRow.position, color: CATEGORY_COLORS[targetRow.category] },
      })
    );
  }

  const resultPositions = apiResults
    .map((r) => rows.find((row) => row.word === r.word)?.position)
    .filter(Boolean);

  if (resultPositions.length) {
    const allPositions = targetRow ? [targetRow.position, ...resultPositions] : resultPositions;
    window.dispatchEvent(
      new CustomEvent("vse:focus-word", { detail: { position: centroidOf(allPositions), radius: 10 } })
    );
  }

  logSuccess("SEARCH", `'${query}' → k=${apiResults.length} results in ${elapsedMs}ms`);
  setEducation("search");
});

// ---------------------------------------------------------------- DELETE

deleteBtn.addEventListener("click", async () => {
  const word = deleteWordEl.value;
  if (!word) { logError("DELETE", "→ no hay vectores para borrar"); return; }

  deleteBtn.disabled = true;

  // Confirma en Qdrant ANTES de modificar la escena
  try {
    const res = await deleteWord(word);
    if (!res.success) throw new Error("Qdrant no confirmó el borrado");
  } catch (e) {
    deleteBtn.disabled = false;
    logError("DELETE", `'${word}' → ${e.message}`);
    return;
  }

  deleteBtn.disabled = false;

  const deletedRow = rows.find((row) => row.word === word);
  removeWordFromScene(word);
  rows = rows.filter((row) => row.word !== word);
  prevPCAPositions.delete(word);
  resetHighlights();
  applyPCA(rows);

  if (deletedRow) {
    window.dispatchEvent(
      new CustomEvent("vse:delete-fx", {
        detail: { position: deletedRow.position, color: CATEGORY_COLORS[deletedRow.category] },
      })
    );
  }

  refreshVectorCount();
  refreshDeleteOptions();
  logSuccess("DELETE", `'${word}' → eliminado de Qdrant`);
  setEducation("delete");
});

// ---------------------------------------------------------------- selección desde la escena 3D

window.addEventListener("vse:word-selected", (event) => {
  const entry = event.detail;
  if (!entry) return;

  highlightWords([entry.word]);
  logSuccess("SELECT", `'${entry.word}' → found`);
  setEducation("select");
  window.dispatchEvent(new CustomEvent("vse:focus-word", { detail: entry }));
});

// ---------------------------------------------------------------- inicio asíncrono: embeddings + PCA

// ---------------------------------------------------------------- onboarding "¿Qué es esto?"
//
// Overlay opcional de 3 pasos, solo en la primera visita (se recuerda
// en localStorage). No bloquea nada del resto de la app: vive en su
// propia capa por encima de #app y se puede saltar en cualquier momento.

const ONBOARDING_SEEN_KEY = "vse-onboarding-seen";
const ONBOARDING_STEPS = [
  {
    icon: "🌌",
    title: "¿Qué es esto?",
    text: "Cada punto de luz del espacio 3D es una palabra convertida en un vector: así es como una IA «entiende» el lenguaje, como coordenadas en un espacio.",
  },
  {
    icon: "🧭",
    title: "Lo parecido, cerca",
    text: "Las palabras con significado similar aparecen más cerca entre sí y se conectan con líneas: así funciona, en esencia, una búsqueda semántica.",
  },
  {
    icon: "⌨️",
    title: "Pruébalo tú mismo",
    text: "Usa el panel de la izquierda como una base de datos vectorial real: inserta, busca y elimina palabras, y observa cómo cambia el espacio.",
  },
];

function showOnboarding() {
  if (localStorage.getItem(ONBOARDING_SEEN_KEY)) return;

  const overlay = document.createElement("div");
  overlay.className = "onboarding-overlay";
  overlay.innerHTML = `
    <div class="onboarding-card">
      <button class="onboarding-skip" id="onboardingSkip">Saltar ✕</button>
      <div class="onboarding-viewport">
        <div class="onboarding-track" id="onboardingTrack">
          ${ONBOARDING_STEPS.map(
            (step) => `
              <div class="onboarding-step">
                <div class="onboarding-step__icon">${step.icon}</div>
                <h2>${step.title}</h2>
                <p>${step.text}</p>
              </div>
            `
          ).join("")}
        </div>
      </div>
      <div class="onboarding-dots" id="onboardingDots">
        ${ONBOARDING_STEPS.map((_, i) => `<span class="onboarding-dot" data-i="${i}"></span>`).join("")}
      </div>
      <button class="terminal-btn" id="onboardingNext">Siguiente</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const track = overlay.querySelector("#onboardingTrack");
  const dots = [...overlay.querySelectorAll(".onboarding-dot")];
  const nextBtn = overlay.querySelector("#onboardingNext");
  const skipBtn = overlay.querySelector("#onboardingSkip");

  let step = 0;

  function render() {
    track.style.transform = `translateX(-${step * (100 / ONBOARDING_STEPS.length)}%)`;
    dots.forEach((dot, i) => dot.classList.toggle("is-active", i === step));
    nextBtn.textContent = step === ONBOARDING_STEPS.length - 1 ? "Empezar" : "Siguiente";
  }

  function close() {
    localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    overlay.remove();
  }

  nextBtn.addEventListener("click", () => {
    if (step === ONBOARDING_STEPS.length - 1) {
      close();
      return;
    }
    step += 1;
    render();
  });

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      step = i;
      render();
    });
  });

  skipBtn.addEventListener("click", close);

  render();
}

// ---------------------------------------------------------------- initializeWordSpace
//
// 1. Muestra overlay de carga (bloquea toda interacción hasta que PCA esté listo).
// 2. Llama a getEmbedding() para cada palabra del dataset en paralelo.
// 3. Corre PCA sobre los vectores reales (o simulados como fallback).
// 4. Dispatch vse:words-ready → scene.js siembra la nube 3D.
// 5. Inicializa rows + panel → fade-out overlay → muestra onboarding.

(async function initializeWordSpace() {
  // ── overlay de carga ─────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.innerHTML = `
    <div class="loading-card">
      <div class="loading-badge">VECTOR DB</div>
      <p class="loading-title">Inicializando espacio vectorial…</p>
      <div class="loading-bar-track">
        <div class="loading-bar-fill" id="loadingBarFill"></div>
      </div>
      <p class="loading-status" id="loadingStatus">Conectando con el backend…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const barFill = document.getElementById("loadingBarFill");
  const statusEl = document.getElementById("loadingStatus");

  // ── listVectors() es la ÚNICA fuente de verdad ───────────────────
  // Reintentos con backoff: en Render free tier el contenedor puede
  // estar durmiendo (cold start ~20-40s). El error CORS que reporta el
  // browser es síntoma de que Render devuelve 503 sin cabeceras propias;
  // cuando el contenedor arranca, las peticiones posteriores funcionan.
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 7000;

  let existing;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      statusEl.textContent = attempt === 1
        ? "Conectando con el backend…"
        : `Backend iniciando… intento ${attempt}/${MAX_RETRIES}`;
      // barra de progreso animada durante la espera
      barFill.style.width = `${(attempt / MAX_RETRIES) * 55}%`;
      existing = await listVectors();
      console.log(`Cargando ${existing.length} vectores desde Qdrant…`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`Intento ${attempt}/${MAX_RETRIES} fallido:`, err.message);
      if (attempt < MAX_RETRIES) {
        statusEl.textContent = `Backend dormido, reintentando en ${RETRY_DELAY_MS / 1000}s… (${attempt}/${MAX_RETRIES})`;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  if (lastErr) {
    console.error("No se pudo conectar con el backend tras varios intentos:", lastErr);
    statusEl.textContent = "⚠ Backend no disponible — escena vacía";
    barFill.style.background = "var(--accent, #f43f5e)";
    barFill.style.width = "100%";
    await new Promise((r) => setTimeout(r, 2500));
    window.dispatchEvent(new CustomEvent("vse:words-ready", { detail: { placements: [] } }));
    rows = [];
    refreshVectorCount();
    refreshDeleteOptions();
    refreshInsertPreview();
    overlay.style.opacity = "0";
    overlay.style.pointerEvents = "none";
    setTimeout(() => { overlay.remove(); showOnboarding(); }, 480);
    return;
  }

  statusEl.textContent =
    existing.length > 0
      ? `${existing.length} vectores recibidos, calculando PCA…`
      : "Colección vacía — escena lista";
  barFill.style.width = "70%";

  // ── PCA sobre los vectores recibidos ─────────────────────────────
  let placements = [];
  let coords = [];

  if (existing.length > 0) {
    const maxDim = Math.max(...existing.map((e) => e.vector.length));
    const vectors = existing.map((e) =>
      e.vector.length === maxDim
        ? e.vector
        : [...e.vector, ...new Array(maxDim - e.vector.length).fill(0)]
    );
    coords = normalizeProjection(pca(vectors, 3), 7);
    placements = existing.map((e, i) => ({
      word: e.word,
      category: e.category,
      vector: e.vector,
      position: makeVector3(coords[i][0], coords[i][1], coords[i][2]),
    }));
  }

  barFill.style.width = "100%";

  rows = placements.map((p) => ({
    word: p.word,
    category: p.category,
    position: p.position,
    vector: p.vector,
  }));

  // Pre-poblar mapa de alineación de signos para INSERT futuros
  placements.forEach((p, i) => {
    prevPCAPositions.set(p.word, [coords[i][0], coords[i][1], coords[i][2]]);
  });

  // ── Notifica a scene.js ───────────────────────────────────────────
  window.dispatchEvent(new CustomEvent("vse:words-ready", { detail: { placements } }));

  refreshVectorCount();
  refreshDeleteOptions();
  refreshInsertPreview();

  logSuccess("READY", `${rows.length} vectores cargados desde Qdrant`);

  // ── Fade out overlay → onboarding ────────────────────────────────
  overlay.style.opacity = "0";
  overlay.style.pointerEvents = "none";
  setTimeout(() => {
    overlay.remove();
    showOnboarding();
  }, 480);
})();
