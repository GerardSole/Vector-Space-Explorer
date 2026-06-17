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
  WORD_DATA,
  CATEGORY_COLORS,
  addWordToScene,
  removeWordFromScene,
  highlightWords,
  resetHighlights,
  getInsertPosition,
  getSimulatedVector,
  getEmbedding,
  repositionWord,
  makeVector3,
} from "./words.js";
import { pca, normalizeProjection } from "./pca.js";

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

  if (!word) {
    logError("INSERT", "→ palabra vacía");
    return;
  }
  if (rows.some((row) => row.word === word)) {
    logError("INSERT", `'${word}' → ya existe`);
    return;
  }

  // loading state — deshabilita el botón mientras espera la API
  insertBtn.disabled = true;
  insertBtn.innerHTML = '<span class="terminal-btn__kw">INSERT INTO</span> Generando vector…';
  insertPreviewEl.textContent = "Generando vector…";

  let embedding;
  let isSimulated = false;
  try {
    embedding = await getEmbedding(word);
  } catch {
    // fallback al vector determinista si Cohere no responde
    embedding = getSimulatedVector(word);
    isSimulated = true;
  } finally {
    insertBtn.disabled = false;
    insertBtn.innerHTML = '<span class="terminal-btn__kw">INSERT INTO</span> vectors';
  }

  // muestra los primeros 6 valores como antes (Cohere devuelve 1024)
  insertPreviewEl.textContent =
    `[${embedding.slice(0, 6).map((v) => v.toFixed(2)).join(", ")}${embedding.length > 6 ? "…" : ""}]`;

  // posición cercana al centroide actual de su categoría (±0.8u)
  const position = getInsertPosition(category);
  addWordToScene(word, position, category);
  rows.push({ word, category, position, vector: embedding });

  // Reposicionamiento semántico: PCA sobre todos los embeddings reales.
  // Las palabras sembradas (sin vector Cohere) no se mueven.
  applyPCA(rows);

  // burst de partículas desde el punto nuevo (lo dibuja scene.js)
  window.dispatchEvent(
    new CustomEvent("vse:insert-fx", { detail: { position, color: CATEGORY_COLORS[category] } })
  );

  refreshVectorCount();
  refreshDeleteOptions();

  if (isSimulated) {
    log(`<span class="db-log__err">⚠</span> ${kw("EMBED")} → Cohere sin respuesta, usando vector simulado`);
  }
  logSuccess("INSERT", `'${word}' → vector[${embedding.length}] from ${isSimulated ? "simulated" : "Cohere"}`);
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

searchBtn.addEventListener("click", () => {
  const query = searchWordEl.value.trim().toLowerCase();
  const k = Number(kSliderEl.value);
  const target = rows.find((row) => row.word === query);

  if (!query) {
    logError("SEARCH", "→ palabra vacía");
    return;
  }
  if (!target) {
    renderSearchResults([]);
    logError("SEARCH", `'${query}' → not found`);
    return;
  }

  // onda expansiva desde el punto buscado (lo dibuja scene.js)
  window.dispatchEvent(
    new CustomEvent("vse:search-fx", {
      detail: { position: target.position, color: CATEGORY_COLORS[target.category] },
    })
  );

  const t0 = performance.now();
  const results = rows
    .filter((row) => row !== target)
    .map((row) => ({ row, distance: target.position.distanceTo(row.position) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
  const elapsedMs = Math.round(performance.now() - t0);

  renderSearchResults(results);
  highlightWords([target.word, ...results.map((r) => r.row.word)]);

  // zoom suave de cámara hacia la zona donde cayeron los resultados
  // (centroide de target + resultados), con un radio más amplio que el
  // foco de una sola palabra para que se vea el grupo completo
  const zoneCenter = centroidOf([target.position, ...results.map((r) => r.row.position)]);
  window.dispatchEvent(
    new CustomEvent("vse:focus-word", { detail: { position: zoneCenter, radius: 10 } })
  );

  logSuccess("SEARCH", `'${query}' → k=${k} results in ${elapsedMs}ms`);
  setEducation("search");
});

// ---------------------------------------------------------------- DELETE

deleteBtn.addEventListener("click", () => {
  const word = deleteWordEl.value;
  if (!word) {
    logError("DELETE", "→ no hay vectores para borrar");
    return;
  }

  // se necesita la posición/categoría ANTES de filtrarla de `rows`, para
  // poder mandar el efecto de implosión al lugar correcto
  const deletedRow = rows.find((row) => row.word === word);

  // removeWordFromScene() solo inicia la animación de salida (scale
  // 1→0 + fade); la remoción real del registro/escena y la
  // regeneración de las líneas ocurren al terminar, dentro de
  // updateWordPulses (words.js).
  removeWordFromScene(word);
  rows = rows.filter((row) => row.word !== word);
  prevPCAPositions.delete(word);
  resetHighlights();

  // Recalcula PCA sin la palabra eliminada para que las demás se reorganicen
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
  logSuccess("DELETE", `'${word}' → vector removed`);
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
      <p class="loading-status" id="loadingStatus">Conectando con Cohere (0 / ${WORD_DATA.length})…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const barFill = document.getElementById("loadingBarFill");
  const statusEl = document.getElementById("loadingStatus");
  const total = WORD_DATA.length;
  let done = 0;

  function updateProgress() {
    done++;
    barFill.style.width = `${(done / total) * 100}%`;
    statusEl.textContent = done < total
      ? `Generando embeddings (${done} / ${total})…`
      : "Calculando PCA…";
  }

  // ── embeddings en paralelo con fallback por palabra ───────────────
  const results = await Promise.all(
    WORD_DATA.map(async (entry) => {
      let vector;
      try {
        vector = await getEmbedding(entry.word);
      } catch {
        vector = getSimulatedVector(entry.word);
      }
      updateProgress();
      return { word: entry.word, category: entry.cluster, vector };
    })
  );

  // ── PCA: normaliza dimensiones (1024 real vs 6 simulado) ──────────
  const maxDim = Math.max(...results.map((r) => r.vector.length));
  const vectors = results.map((r) =>
    r.vector.length === maxDim
      ? r.vector
      : [...r.vector, ...new Array(maxDim - r.vector.length).fill(0)]
  );
  const coords = normalizeProjection(pca(vectors, 3), 7);

  // ── placements: posición THREE.Vector3 + vector para userData ─────
  const placements = results.map((r, i) => ({
    word: r.word,
    category: r.category,
    vector: r.vector,
    position: makeVector3(coords[i][0], coords[i][1], coords[i][2]),
  }));

  // ── inicializar rows con posiciones y vectores reales ─────────────
  rows = placements.map((p) => ({
    word: p.word,
    category: p.category,
    position: p.position,
    vector: p.vector,
  }));

  // Pre-poblar mapa de alineación de signos para que el primer INSERT
  // del usuario no cause un flip de espejo respecto al layout inicial.
  placements.forEach((p, i) => {
    prevPCAPositions.set(p.word, [coords[i][0], coords[i][1], coords[i][2]]);
  });

  // ── notificar a scene.js ──────────────────────────────────────────
  window.dispatchEvent(new CustomEvent("vse:words-ready", { detail: { placements } }));

  // ── refrescar panel izquierdo ─────────────────────────────────────
  refreshVectorCount();
  refreshDeleteOptions();
  refreshInsertPreview();

  const src = results[0].vector.length === 1024 ? "Cohere" : "simulados";
  logSuccess("READY", `${rows.length} embeddings cargados (${src})`);

  // ── fade out overlay → onboarding ────────────────────────────────
  overlay.style.opacity = "0";
  overlay.style.pointerEvents = "none";
  setTimeout(() => {
    overlay.remove();
    showOnboarding();
  }, 480);
})();
