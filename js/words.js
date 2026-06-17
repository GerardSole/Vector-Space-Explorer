/**
 * words.js — sistema de representación de palabras en la escena 3D
 * + capa de datos del "Vector DB".
 *
 * Cada palabra se representa como un pequeño THREE.Group con dos
 * sprites:
 *   - "glow"  → punto de luz brillante (textura gaussiana blanco→
 *               transparente, compartida y teñida por categoría)
 *   - "label" → el texto de la palabra, sobre el punto
 *
 * API pública de representación (consumida por scene.js / ui.js):
 *   - initWordDataset(scene)   — siembra el dataset curado (llamar una vez)
 *   - addWordToScene(word, position, category)
 *   - removeWordFromScene(word)
 *   - highlightWords(wordList)
 *   - resetHighlights()
 *   - updateConnections()
 *
 * Además expone el dataset curado por zonas (WORD_DATA / CLUSTERS) y
 * una utilidad de vecinos más cercanos basada en distancia 3D, que usa
 * el panel izquierdo.
 */

import * as THREE from "three";

export const DIMENSIONS = 3; // el "vector" de cada palabra es directamente su posición 3D

// ---------------------------------------------------------------- categorías

export const CATEGORY_COLORS = {
  emotion: "#a855f7",
  nature: "#06b6d4",
  animal: "#10b981",
  object: "#f59e0b",
  person: "#f43f5e",
  custom: "#6366f1",
};

function hexToNumber(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

export const CLUSTERS = [
  { name: "emotion", color: hexToNumber(CATEGORY_COLORS.emotion) },
  { name: "nature",  color: hexToNumber(CATEGORY_COLORS.nature) },
  { name: "animal",  color: hexToNumber(CATEGORY_COLORS.animal) },
  { name: "object",  color: hexToNumber(CATEGORY_COLORS.object) },
  { name: "person",  color: hexToNumber(CATEGORY_COLORS.person) },
];

// ---------------------------------------------------------------- dataset curado por zonas
//
// A diferencia de un dataset generado por embeddings + proyección
// aleatoria, aquí la posición ES la información semántica: cada
// categoría vive en una zona fija y reconocible del espacio 3D. Las
// palabras dentro de cada zona se reparten en un pequeño círculo
// determinista (no aleatorio) alrededor del punto de anclaje.
//
// Nota: la consigna pedía 25 palabras pero lista 24 (6+6+5+4+3) — se
// implementan exactamente las 24 listadas.
const ZONES = [
  { category: "emotion", anchor: new THREE.Vector3(-6, 5, 0), words: ["amor", "alegría", "tristeza", "miedo", "nostalgia", "esperanza"] }, // zona -X, +Y
  { category: "nature",  anchor: new THREE.Vector3(8, 0, 0),  words: ["océano", "bosque", "montaña", "lluvia", "sol", "tormenta"] },        // zona +X
  { category: "animal",  anchor: new THREE.Vector3(0, -7, 0), words: ["perro", "gato", "lobo", "águila", "delfín"] },                        // zona -Y
  { category: "object",  anchor: new THREE.Vector3(0, 0, 7),  words: ["libro", "música", "ciudad", "silencio"] },                            // zona +Z
  // radio reducido: con solo 3 palabras, el radio default (1.6) las deja
  // a ~2.8 entre sí — por encima del umbral de conexión (2.5) — y
  // quedaban sin líneas internas, a diferencia de las demás zonas.
  { category: "person",  anchor: new THREE.Vector3(5, 7, 0),  words: ["madre", "amigo", "héroe"], localRadius: 1.3 }, // zona +X, +Y
];

const ZONE_LOCAL_RADIUS = 1.6; // radio del pequeño círculo donde se reparten las palabras de una zona
const MIN_WORD_SEPARATION = 1.6; // distancia mínima garantizada entre palabras de una misma zona

/** Posición determinista de la i-ésima palabra (de `total`) alrededor del anclaje de su zona. */
function zonePosition(anchor, index, total, radius) {
  const angle = (index / total) * Math.PI * 2;
  return new THREE.Vector3(
    anchor.x + Math.cos(angle) * radius,
    anchor.y + Math.sin(angle * 1.3) * radius * 0.6,
    anchor.z + Math.sin(angle) * radius
  );
}

/**
 * Empuja pares de puntos demasiado cercanos hasta una distancia mínima,
 * sin alterar a los que ya están suficientemente separados.
 */
function relaxPositions(positions, minSeparation, iterations = 60) {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        const delta = b.clone().sub(a);
        let dist = delta.length();
        if (dist < 1e-6) {
          delta.set(1, 0, 0);
          dist = 1e-3;
        }
        if (dist < minSeparation) {
          const push = (minSeparation - dist) / 2;
          delta.multiplyScalar(1 / dist);
          a.addScaledVector(delta, -push);
          b.addScaledVector(delta, push);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function buildDataset() {
  const data = [];
  let id = 0;

  ZONES.forEach((zone) => {
    const radius = zone.localRadius ?? ZONE_LOCAL_RADIUS;
    const positions = zone.words.map((_, i) => zonePosition(zone.anchor, i, zone.words.length, radius));

    // garantiza una separación mínima legible entre las palabras de
    // esta misma zona (ver relaxPositions)
    relaxPositions(positions, MIN_WORD_SEPARATION);

    zone.words.forEach((word, i) => {
      const position = positions[i];
      data.push({
        id: id++,
        word,
        cluster: zone.category, // = categoría (nombre conservado por compatibilidad con ui.js)
        color: hexToNumber(CATEGORY_COLORS[zone.category]),
        vector: [position.x, position.y, position.z], // el "embedding" es la posición misma
        position,
      });
    });
  });

  return data;
}

export const WORD_DATA = buildDataset();

const ZONE_ANCHOR_BY_CATEGORY = Object.fromEntries(ZONES.map((z) => [z.category, z.anchor]));
const CUSTOM_INSERT_ANCHOR = new THREE.Vector3(0, 0, 0); // "custom" no tiene zona propia: centro de la formación

/**
 * Posición y color de cada zona (sin "custom", que no tiene zona
 * propia). La usa scene.js para dibujar las nebulosas de fondo, muy
 * sutiles, detrás de cada categoría.
 */
export const ZONE_ANCHORS = ZONES.map((zone) => ({
  category: zone.category,
  position: zone.anchor.clone(),
  color: CATEGORY_COLORS[zone.category],
}));

/**
 * Devuelve una posición razonable (con jitter aleatorio) para insertar
 * dinámicamente una palabra nueva de `category`, cerca de la zona que
 * le corresponde. La usa ui.js para la sección INSERT.
 * @param {string} category
 * @returns {THREE.Vector3}
 */
export function getInsertPosition(category) {
  const centroid = getCategoryCentroid(category);
  const jitter = () => (Math.random() - 0.5) * 1.6; // ±0.8 unidades
  return new THREE.Vector3(centroid.x + jitter(), centroid.y + jitter(), centroid.z + jitter());
}

/**
 * Centroide de las palabras de `category` actualmente en escena (no del
 * dataset original: refleja inserts/deletes en vivo). Si la categoría
 * todavía no tiene ninguna palabra, cae al ancla de su zona (o al
 * centro de la formación, para "custom").
 */
function getCategoryCentroid(category) {
  const inCategory = [...registry.values()].filter((entry) => entry.category === category);
  if (inCategory.length === 0) {
    return ZONE_ANCHOR_BY_CATEGORY[category] ?? CUSTOM_INSERT_ANCHOR;
  }
  const sum = inCategory.reduce(
    (acc, entry) => acc.add(entry.group.position),
    new THREE.Vector3()
  );
  return sum.divideScalar(inCategory.length);
}

/** Vecinos más cercanos por distancia 3D (no hay embedding separado: la posición es el vector). */
export function nearestNeighbors(target, k = 4) {
  return WORD_DATA
    .filter((w) => w.id !== target.id)
    .map((w) => ({ word: w, similarity: 1 / (1 + target.position.distanceTo(w.position)) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

// ---------------------------------------------------------------- vector "simulado" (educativo)
//
// IMPORTANTE: esto NO es un embedding real. Es un vector decorativo
// que ilustra "así se vería" lo que una base de datos vectorial real
// guardaría — pero generado de forma determinista a partir de la
// palabra (seed), no aleatoria: borrar e reinsertar la misma palabra
// siempre devuelve exactamente los mismos 6 números. En producción,
// ese vector lo calcularía un modelo de embeddings real (p. ej.
// OpenAI text-embedding-3-small), con cientos o miles de dimensiones.
const SIMULATED_VECTOR_LENGTH = 6;

function hashWordSeed(word) {
  let h = 1779033703 ^ word.length;
  for (let i = 0; i < word.length; i++) {
    h = Math.imul(h ^ word.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * Vector simulado determinista de `word`: siempre el mismo array de 6
 * números para la misma palabra (mismo seed → mismo PRNG → mismos
 * valores). No es un embedding real, ver nota más arriba.
 * @param {string} word
 * @returns {number[]}
 */
export function getSimulatedVector(word) {
  const rng = hashWordSeed(word.trim().toLowerCase());
  return Array.from({ length: SIMULATED_VECTOR_LENGTH }, () => +(rng() * 2 - 1).toFixed(2));
}

/**
 * Obtiene el embedding real de `word` desde /api/embed (proxy seguro a
 * Cohere embed-multilingual-v3.0, 1024 dimensiones). Lanza un Error si
 * la llamada falla — el caller gestiona el fallback y los avisos de UI.
 * @param {string} word
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(word) {
  const res = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: word }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const { embedding } = await res.json();
  return embedding;
}

// ================================================================
// Sistema de representación 3D de palabras
// ================================================================

const GLOW_SIZE = 0.4; // tamaño base del punto de luz, en unidades de mundo
const LABEL_WIDTH = 1.15;
const LABEL_HEIGHT = 0.29;
const LABEL_OFFSET_Y = 0.32; // el label flota justo encima del punto

const DEFAULT_GLOW_OPACITY = 0.85;
const DEFAULT_LABEL_OPACITY = 0.8;
const HIGHLIGHT_GLOW_OPACITY = 1;
const HIGHLIGHT_LABEL_OPACITY = 1;
const DIM_GLOW_OPACITY = 0.12;
const DIM_LABEL_OPACITY = 0.15;

// animación de entrada/salida (INSERT / DELETE): escala del grupo
// completo (punto + label), con ease — independiente del pulso, que
// sigue corriendo sobre glow.scale.
const SPAWN_DURATION = 450; // ms, escala 0→1 al insertar
const REMOVE_DURATION = 350; // ms, escala 1→0 + fade al eliminar

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
  return t * t * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Temporizador para reconstruir conexiones tras el vuelo de PCA.
// Usando setTimeout en lugar de un contador por palabra: cada llamada
// a repositionWord() resetea el reloj; las conexiones se reconstruyen
// una sola vez, ~50 ms después de que terminan todas las animaciones.
let reconnectTimeout = null;

/** Grupo raíz: scene.js solo necesita hacer scene.add(wordGroup) una vez. */
export const wordGroup = new THREE.Group();
wordGroup.name = "word-cloud";

// word (string) -> { group, glow, label, category, phase, highlighted }
const registry = new Map();

// --- textura de glow: gaussiana blanca, compartida y teñida por categoría ---
let glowTextureCache = null;

function getGlowTexture() {
  if (glowTextureCache) return glowTextureCache;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  glowTextureCache = new THREE.CanvasTexture(canvas);
  glowTextureCache.needsUpdate = true;
  return glowTextureCache;
}

// --- textura de label: texto centrado, una por palabra ---
function createLabelTexture(word) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  ctx.font = "30px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#e6e7ee";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(word, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createWordVisual(word, category) {
  const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.custom;

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: DEFAULT_GLOW_OPACITY,
    })
  );
  glow.scale.set(GLOW_SIZE, GLOW_SIZE, 1);

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createLabelTexture(word),
      transparent: true,
      depthWrite: false,
      opacity: DEFAULT_LABEL_OPACITY,
    })
  );
  label.scale.set(LABEL_WIDTH, LABEL_HEIGHT, 1);
  label.position.set(0, GLOW_SIZE / 2 + LABEL_OFFSET_Y, 0);

  const group = new THREE.Group();
  group.add(glow, label);

  return { group, glow, label };
}

/**
 * Agrega una palabra a la escena: crea su punto de luz + label y los
 * registra para que el pulso y el highlight puedan animarlos.
 * Si la palabra ya existe, la reemplaza.
 *
 * @param {string} word
 * @param {THREE.Vector3} position
 * @param {string} category una de las claves de CATEGORY_COLORS (si no
 *   se reconoce, se usa "custom")
 * @returns {THREE.Group} el grupo agregado a wordGroup
 */
export function addWordToScene(word, position, category = "custom") {
  // reemplazo inmediato (no animado): removeWordFromScene() ahora solo
  // inicia una animación de salida async, y como aquí la vamos a
  // recrear en el mismo instante, animar su desaparición no tendría
  // sentido — y dejaría el grupo viejo huérfano (nunca se volvería a
  // visitar en updateWordPulses, porque registry.set() de más abajo
  // pisa la entrada antes de que termine su propia animación).
  if (registry.has(word)) finalizeRemoval(word);

  const { group, glow, label } = createWordVisual(word, category);
  group.position.copy(position);
  group.scale.setScalar(0); // arranca en 0: updateWordPulses() la anima hasta 1

  const userData = { word, category, position: position.clone() };
  glow.userData = userData;
  label.userData = userData;
  group.userData = userData;

  wordGroup.add(group);
  registry.set(word, {
    group,
    glow,
    label,
    category,
    phase: Math.random() * Math.PI * 2, // desincroniza el pulso entre palabras
    highlighted: null,
    spawnAt: performance.now(),
    removing: false,
    removeAt: null,
  });

  updateConnections();
  return group;
}

/**
 * Inicia la animación de salida de una palabra (escala 1→0 + fade). La
 * remoción real de la escena/registro ocurre al terminar la animación,
 * dentro de updateWordPulses() (ver finalizeRemoval).
 * @param {string} word
 */
export function removeWordFromScene(word) {
  const entry = registry.get(word);
  if (!entry || entry.removing) return;

  entry.removing = true;
  entry.removeAt = performance.now();
  // si todavía estaba a mitad de su animación de entrada, la salida
  // continúa desde ahí (no "salta" a escala completa antes de achicarse)
  entry.removeFromScale = entry.group.scale.x;
}

/**
 * Quita definitivamente una palabra de la escena y libera sus
 * materiales/texturas (la textura de glow es compartida y no se libera).
 * Llamada internamente cuando termina la animación de salida.
 * @param {string} word
 */
function finalizeRemoval(word) {
  const entry = registry.get(word);
  if (!entry) return;

  wordGroup.remove(entry.group);

  entry.glow.material.dispose();
  entry.label.material.map?.dispose();
  entry.label.material.dispose();

  registry.delete(word);
  updateConnections();
}

/**
 * Resalta las palabras indicadas (más brillo) y atenúa el resto.
 * @param {Array<string|{word: string}>} wordList
 */
export function highlightWords(wordList) {
  const targets = new Set(wordList.map((w) => (typeof w === "string" ? w : w.word)));

  registry.forEach((entry, word) => {
    const isMatch = targets.has(word);
    entry.glow.material.opacity = isMatch ? HIGHLIGHT_GLOW_OPACITY : DIM_GLOW_OPACITY;
    entry.label.material.opacity = isMatch ? HIGHLIGHT_LABEL_OPACITY : DIM_LABEL_OPACITY;
    entry.highlighted = isMatch;
  });
}

/**
 * Vecinos más cercanos de `word` por distancia 3D real, usando el
 * estado EN VIVO de la escena (registry: incluye inserts/deletes,
 * no solo el dataset original). Usado por el tooltip educativo.
 * @param {string} word debe existir actualmente en la escena
 * @param {number} k
 * @returns {Array<{word: string, category: string, distance: number}>}
 */
export function getNearestWords(word, k = 3) {
  const origin = registry.get(word);
  if (!origin) return [];

  return [...registry.entries()]
    .filter(([w]) => w !== word)
    .map(([w, entry]) => ({
      word: w,
      category: entry.category,
      distance: origin.group.position.distanceTo(entry.group.position),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
}

/**
 * Devuelve el THREE.Group de una palabra ya agregada (o null), para
 * que quien lo consuma pueda leer su posición en vivo cada frame
 * (p.ej. para seguirla con la cámara mientras wordGroup sigue
 * rotando) en vez de quedarse con una posición fija del momento del
 * click.
 * @param {string} word
 * @returns {THREE.Group | null}
 */
export function getWordGroup(word) {
  return registry.get(word)?.group ?? null;
}

/** Quita cualquier highlight/atenuación activo y vuelve al brillo normal. */
export function resetHighlights() {
  registry.forEach((entry) => {
    entry.glow.material.opacity = DEFAULT_GLOW_OPACITY;
    entry.label.material.opacity = DEFAULT_LABEL_OPACITY;
    entry.highlighted = null;
  });
}

/**
 * Anima suavemente una palabra desde su posición actual hasta
 * `targetPosition` en `duration` ms (easeInOutCubic). Mientras dura el
 * vuelo, las líneas de conexión se ocultan; se reconstruyen al final.
 *
 * Se puede llamar varias veces seguidas (para un batch de PCA): el
 * timeout de reconexión se resetea con cada llamada y solo dispara una
 * vez, cuando todas las animaciones han terminado.
 *
 * @param {string}        word
 * @param {{x,y,z}}       targetPosition  THREE.Vector3 o plain object
 * @param {number}        duration         ms (default 800)
 */
export function repositionWord(word, targetPosition, duration = 800) {
  const entry = registry.get(word);
  if (!entry || entry.removing) return;

  connectionsGroup.visible = false;
  clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    updateConnections();
    connectionsGroup.visible = true;
  }, duration + 60);

  entry.repoFrom = entry.group.position.clone();
  entry.repoTo = new THREE.Vector3(targetPosition.x, targetPosition.y, targetPosition.z);
  entry.repoAt = performance.now();
  entry.repoDuration = duration;
}

/**
 * Avanza la animación de pulso de todos los puntos de luz, y la
 * animación de entrada/salida (INSERT/DELETE) de cada palabra. Debe
 * llamarse una vez por frame desde el loop de render, con el tiempo
 * transcurrido (segundos) — el pulso usa ese tiempo; la animación de
 * entrada/salida usa su propio reloj (performance.now()), así no
 * depende de en qué momento del clock de la escena haya ocurrido el
 * insert/delete.
 * @param {number} time
 */
export function updateWordPulses(time) {
  const now = performance.now();
  const finished = [];

  registry.forEach((entry, word) => {
    const { glow, label, group, phase, removing, removeAt, spawnAt } = entry;

    const pulse = 1.075 + 0.075 * Math.sin(time + phase); // rango [1.0, 1.15]
    const scale = GLOW_SIZE * pulse;
    glow.scale.set(scale, scale, 1);

    if (removing) {
      const t = Math.min(1, (now - removeAt) / REMOVE_DURATION);
      const lifecycleScale = entry.removeFromScale * (1 - easeInCubic(t)); // removeFromScale → 0
      group.scale.setScalar(lifecycleScale);
      glow.material.opacity = DEFAULT_GLOW_OPACITY * lifecycleScale;
      label.material.opacity = DEFAULT_LABEL_OPACITY * lifecycleScale;
      if (t >= 1) finished.push(word);
    } else {
      const t = Math.min(1, (now - spawnAt) / SPAWN_DURATION);
      group.scale.setScalar(easeOutCubic(t)); // 0 → 1
    }

    // Animación de reposicionamiento por PCA (lerp posición)
    if (entry.repoTo) {
      const rt = Math.min(1, (now - entry.repoAt) / entry.repoDuration);
      group.position.lerpVectors(entry.repoFrom, entry.repoTo, easeInOutCubic(rt));
      if (rt >= 1) {
        group.position.copy(entry.repoTo);
        // Sincroniza userData.position para que tooltip y search usen la posición final
        const snapped = entry.repoTo.clone();
        group.userData.position = snapped;
        glow.userData.position = snapped;
        label.userData.position = snapped;
        entry.repoFrom = null;
        entry.repoTo = null;
      }
    }
  });

  // se finaliza después de iterar para no mutar `registry` a mitad del forEach
  finished.forEach((word) => finalizeRemoval(word));
}

// ================================================================
// Conexiones entre palabras
// ================================================================
//
// Líneas entre cada par de palabras a menos de MAX_CONNECTION_DISTANCE,
// con opacidad proporcional a la proximidad y un gradiente de color
// entre los colores de categoría de ambos extremos.

const MAX_CONNECTION_DISTANCE = 2.5;
const CONNECTION_PULSE_AMPLITUDE = 0.1; // ±0.1 de opacidad

/** Hijo de wordGroup: hereda automáticamente su rotación, así las
 * líneas nunca se desincronizan visualmente de los puntos que conectan. */
export const connectionsGroup = new THREE.Group();
connectionsGroup.name = "word-connections";
wordGroup.add(connectionsGroup);

// líneas activas en este momento: { line, baseOpacity }
let connectionLines = [];

function disposeConnections() {
  connectionLines.forEach(({ line }) => {
    connectionsGroup.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  });
  connectionLines = [];
}

/**
 * Recalcula la distancia entre cada par de palabras presentes en la
 * escena y reconstruye las líneas de conexión (distancia < 2.5).
 * addWordToScene() y removeWordFromScene() ya la llaman automáticamente,
 * pero también se exporta para poder forzar una regeneración manual.
 */
export function updateConnections() {
  disposeConnections();

  const entries = [...registry.values()];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      const distance = a.group.position.distanceTo(b.group.position);
      if (distance >= MAX_CONNECTION_DISTANCE) continue;

      // proximidad 0..1 (1 = superpuestas, 0 = justo en el límite)
      const proximity = 1 - distance / MAX_CONNECTION_DISTANCE;
      const baseOpacity = proximity;

      const colorA = new THREE.Color(CATEGORY_COLORS[a.category] ?? CATEGORY_COLORS.custom);
      const colorB = new THREE.Color(CATEGORY_COLORS[b.category] ?? CATEGORY_COLORS.custom);

      const geometry = new THREE.BufferGeometry().setFromPoints([
        a.group.position,
        b.group.position,
      ]);
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(
          new Float32Array([colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b]),
          3
        )
      );

      const material = new THREE.LineBasicMaterial({
        vertexColors: true, // el degradado entre colorA y colorB lo interpola la GPU
        transparent: true,
        opacity: baseOpacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(geometry, material);
      connectionsGroup.add(line);
      connectionLines.push({ line, baseOpacity });
    }
  }
}

/**
 * Avanza el pulso de opacidad de las líneas de conexión. Debe llamarse
 * una vez por frame desde el loop de render, igual que updateWordPulses.
 * @param {number} time
 */
export function updateConnectionPulses(time) {
  const pulse = Math.sin(time) * CONNECTION_PULSE_AMPLITUDE;
  connectionLines.forEach(({ line, baseOpacity }) => {
    line.material.opacity = THREE.MathUtils.clamp(baseOpacity + pulse, 0, 1);
  });
}

/**
 * Siembra el dataset curado (24 palabras) en la escena: agrega
 * wordGroup a `scene` y crea cada palabra con addWordToScene(). Pensada
 * para llamarse una sola vez al inicio, p. ej. justo después de
 * initParticles(scene) en scene.js.
 *
 * addWordToScene() solo conoce (word, position, category), pero aquí sí
 * tenemos la entrada completa del dataset (id, vector, cluster...) — se
 * la asignamos como userData para que el panel de detalle y los vecinos
 * más cercanos sigan funcionando cuando se selecciona desde la escena.
 *
 * @param {THREE.Scene} scene
 */
export function initWordDataset(scene) {
  scene.add(wordGroup);

  WORD_DATA.forEach((entry) => {
    const group = addWordToScene(entry.word, entry.position, entry.cluster);
    // entry.cluster es el nombre histórico de este mismo dato (ver
    // buildDataset): se agrega también como `category` porque es el
    // nombre que usan addWordToScene/CATEGORY_COLORS y, ahora, el
    // tooltip — así hit.userData.category funciona tanto para estas
    // palabras del dataset curado como para las insertadas a mano.
    const userData = { ...entry, category: entry.cluster };
    group.userData = userData;
    group.children.forEach((child) => {
      child.userData = userData;
    });
  });
}
