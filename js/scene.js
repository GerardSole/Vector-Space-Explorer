/**
 * scene.js — montaje y render del canvas 3D (panel derecho).
 *
 * Responsable de: renderer/cámara, controles orbitales MANUALES (sin
 * librerías externas como OrbitControls), niebla, luces animadas, loop
 * de animación, resize, raycasting para selección de palabras, la
 * animación de "vuelo" de cámara hacia un vector seleccionado, las
 * nebulosas de fondo por categoría y los efectos transitorios de
 * INSERT/SEARCH/DELETE.
 *
 * Se comunica con ui.js exclusivamente vía CustomEvents en window,
 * para mantener ambos módulos independientes entre sí:
 *   - emite   "vse:word-selected"  { detail: wordEntry }     al clickear un punto
 *   - escucha "vse:focus-word"     { detail: wordEntry }     para orbitar hacia el vector
 *   - escucha "vse:reset-camera"                              para volver al encuadre inicial
 *   - escucha "vse:toggle-particles"                          para mostrar/ocultar el fondo
 *   - escucha "vse:insert-fx"      { detail: {position,color} } → burst de partículas
 *   - escucha "vse:search-fx"      { detail: {position,color} } → onda expansiva
 *   - escucha "vse:delete-fx"      { detail: {position,color} } → implosión
 */

import * as THREE from "three";
import {
  initParticles,
  updateParticles,
  setParticlesVisible,
  createGlowTexture,
  spawnInsertBurst,
  spawnDeleteImplosion,
  spawnSearchPulse,
  updateEffects,
} from "./particles.js";
import {
  wordGroup,
  connectionsGroup,
  updateWordPulses,
  updateConnectionPulses,
  getWordGroup,
  initWordDataset,
  CATEGORY_COLORS,
  ZONE_ANCHORS,
  getSimulatedVector,
  getNearestWords,
} from "./words.js";

const viewport = document.getElementById("viewport");
const canvas = document.getElementById("scene-canvas");

// ---------------------------------------------------------------- setup

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07070f");
scene.fog = new THREE.Fog("#07070f", 15, 30);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 0, 16);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// luces: ambient tenue + 2 point lights animadas (indigo / cyan)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.18);
const light1 = new THREE.PointLight(0x6366f1, 2.2, 60);
const light2 = new THREE.PointLight(0x06b6d4, 2.2, 60);
scene.add(ambientLight, light1, light2);

const particles = initParticles(scene);
// Las palabras entran cuando ui.js termina de obtener embeddings reales
// de Cohere y recalcular PCA — ese módulo dispara vse:words-ready.

// nebulosas de fondo, muy sutiles, una por zona/categoría — decorativas,
// se crean una sola vez y no se animan (sin costo por frame). Viven en
// su propio grupo, hijo de wordGroup para rotar junto con sus palabras
// sin desalinearse, pero separado para poder excluirlas del raycasting
// de picking (ver getIntersectedWord) — son sprites grandes y, si no se
// excluyeran, interferirían con el hover/click de las palabras cercanas.
const nebulaGroup = new THREE.Group();
nebulaGroup.name = "category-nebulas";
wordGroup.add(nebulaGroup);

(function createCategoryNebulas() {
  const nebulaTexture = createGlowTexture();
  ZONE_ANCHORS.forEach(({ position, color }) => {
    const material = new THREE.SpriteMaterial({
      map: nebulaTexture,
      color,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nebula = new THREE.Sprite(material);
    nebula.position.copy(position);
    nebula.scale.set(14, 14, 1);
    nebulaGroup.add(nebula);
  });
})();

// ---------------------------------------------------------------- resize

function resize() {
  const { clientWidth, clientHeight } = viewport;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight || 1;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe(viewport);
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------- controles orbitales manuales
//
// Coordenadas esféricas (radius, theta, phi) alrededor de un punto
// "target". La cámara se recalcula cada frame a partir de estos tres
// valores, así que tanto el drag como el zoom y el "vuelo" hacia un
// vector seleccionado son solo animaciones de estos números.

const MIN_RADIUS = 4; // zoom mínimo: exploración de detalle, cerca de las palabras
const MAX_RADIUS = 20; // zoom máximo: la nube completa cabe con margen (ver words.js)
const PHI_MIN = 0.08;
const PHI_MAX = Math.PI - 0.08;
const ROTATE_SPEED = 0.0035; // rad por píxel arrastrado
const ZOOM_SPEED = 0.01; // por unidad de deltaY de la rueda
const PINCH_ZOOM_SPEED = 0.02; // por píxel de variación entre dos dedos

const DEFAULT_THETA = 0;
const DEFAULT_PHI = Math.PI / 2;
const DEFAULT_RADIUS = 16;

let theta = DEFAULT_THETA;
let phi = DEFAULT_PHI;
let radius = DEFAULT_RADIUS;

const target = new THREE.Vector3(0, 0, 0);
const desiredTarget = new THREE.Vector3(0, 0, 0);
let desiredRadius = DEFAULT_RADIUS;
let resetting = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateCameraFromSpherical() {
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(target);
}

canvas.style.touchAction = "none"; // evita scroll/zoom nativo del navegador al usar dedos
canvas.style.cursor = "grab";

// pointer events unifican mouse + touch + pen; para soportar pinch-zoom
// con dos dedos llevamos un registro de todos los punteros activos.
const activePointers = new Map(); // pointerId -> { x, y }
let lastDragPointerId = null;
let pinchPrevDistance = null;

function pointerDistance() {
  const pts = [...activePointers.values()];
  const dx = pts[0].x - pts[1].x;
  const dy = pts[0].y - pts[1].y;
  return Math.hypot(dx, dy);
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  hideTooltip(); // no tiene sentido mientras se arrastra/hace pinch

  if (activePointers.size === 1) {
    lastDragPointerId = event.pointerId;
    canvas.style.cursor = "grabbing";
  } else if (activePointers.size === 2) {
    pinchPrevDistance = pointerDistance();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) {
    handleHover(event);
    return;
  }

  const prev = activePointers.get(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size >= 2) {
    // pinch zoom con dos dedos
    const distance = pointerDistance();
    if (pinchPrevDistance != null) {
      const delta = distance - pinchPrevDistance;
      radius = clamp(radius - delta * PINCH_ZOOM_SPEED, MIN_RADIUS, MAX_RADIUS);
      desiredRadius = radius;
    }
    pinchPrevDistance = distance;
  } else if (activePointers.size === 1 && event.pointerId === lastDragPointerId) {
    // rotación con un dedo / mouse
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    theta -= dx * ROTATE_SPEED;
    phi = clamp(phi - dy * ROTATE_SPEED, PHI_MIN, PHI_MAX);
  }
});

function endPointer(event) {
  activePointers.delete(event.pointerId);
  pinchPrevDistance = activePointers.size >= 2 ? pointerDistance() : null;
  if (activePointers.size === 0) {
    canvas.style.cursor = "grab";
  } else {
    // si queda un puntero, que se convierta en el nuevo "drag"
    lastDragPointerId = [...activePointers.keys()][0];
  }
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (event) => {
  if (activePointers.size <= 1) endPointer(event);
  hideTooltip(); // el puntero salió del canvas: ya no hay nada que mostrar
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    radius = clamp(radius + event.deltaY * ZOOM_SPEED, MIN_RADIUS, MAX_RADIUS);
    desiredRadius = radius;
  },
  { passive: false }
);

// ---------------------------------------------------------------- picking

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setPointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getIntersectedWord(event) {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  // wordGroup.children = [...grupos de palabras, connectionsGroup,
  // nebulaGroup]. Solo nos interesan los grupos de palabras: probar
  // contra las líneas de conexión (pueden ser cientos con muchas
  // palabras) y contra las nebulosas (sprites grandes) es trabajo
  // desperdiciado en cada movimiento del mouse, y justo el tipo de
  // costo que crece con la cantidad de palabras en escena.
  const pickable = wordGroup.children.filter(
    (child) => child !== connectionsGroup && child !== nebulaGroup
  );

  // recursive: true porque cada palabra es un Group (glow + label), no
  // un sprite directo hijo de wordGroup
  const hits = raycaster.intersectObjects(pickable, true);
  return hits.length ? hits[0].object : null;
}

// ---------------------------------------------------------------- tooltip educativo (hover)

const tooltip = document.createElement("div");
tooltip.className = "scene-tooltip";
tooltip.hidden = true;
viewport.appendChild(tooltip);

let tooltipWord = null; // palabra actualmente mostrada, para no reconstruir el HTML en cada frame

function hideTooltip() {
  tooltip.hidden = true;
  tooltipWord = null;
}

function buildTooltipContent(word, category) {
  const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.custom;
  const vector = getSimulatedVector(word);
  const neighbors = getNearestWords(word, 3);

  const neighborsHtml = neighbors.length
    ? neighbors
        .map((n) => `<li><span>${n.word}</span><span>${n.distance.toFixed(2)}</span></li>`)
        .join("")
    : `<li class="scene-tooltip__empty">sin otras palabras cerca</li>`;

  tooltip.innerHTML = `
    <div class="scene-tooltip__word">${word}</div>
    <div class="scene-tooltip__category" style="color:${color}">${category}</div>
    <div class="scene-tooltip__label">vector simulado</div>
    <div class="scene-tooltip__vector">[${vector.join(", ")}]</div>
    <div class="scene-tooltip__label">3 más cercanas</div>
    <ul class="scene-tooltip__neighbors">${neighborsHtml}</ul>
  `;
}

function positionTooltip(event) {
  const rect = viewport.getBoundingClientRect();
  let left = event.clientX - rect.left + 18;
  let top = event.clientY - rect.top + 18;

  // que no se salga del panel derecho
  left = Math.min(left, rect.width - tooltip.offsetWidth - 8);
  top = Math.min(top, rect.height - tooltip.offsetHeight - 8);

  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function updateTooltip(event, hit) {
  if (!hit) {
    hideTooltip();
    return;
  }

  const { word, category } = hit.userData;
  if (word !== tooltipWord) {
    tooltipWord = word;
    buildTooltipContent(word, category);
  }

  tooltip.hidden = false;
  positionTooltip(event);
}

function handleHover(event) {
  // el cursor "pointer" solo aplica a mouse: en touch no existe hover,
  // la selección se resuelve directamente en el handler de "click"
  if (event.pointerType && event.pointerType !== "mouse") {
    hideTooltip();
    return;
  }
  const hit = getIntersectedWord(event);
  canvas.style.cursor = hit ? "pointer" : "grab";
  updateTooltip(event, hit);
}

canvas.addEventListener("click", (event) => {
  const hit = getIntersectedWord(event);
  if (!hit) return;
  window.dispatchEvent(
    new CustomEvent("vse:word-selected", { detail: hit.userData })
  );
});

// ---------------------------------------------------------------- foco en vector seleccionado

// objeto que la cámara debe seguir frame a frame (no solo apuntar a una
// posición fija): wordGroup rota continuamente, así que si solo
// copiáramos entry.position una vez, la palabra "se escaparía" del
// punto fijo a medida que la nube sigue girando.
let followedObject = null;

window.addEventListener("vse:focus-word", (event) => {
  const entry = event.detail;
  if (!entry) return;

  resetting = false;
  // entry.word es opcional: ui.js también dispara este evento con un
  // punto sintético (p.ej. el centroide de una "zona de resultados" de
  // SEARCH) que no corresponde a ninguna palabra real de la escena.
  followedObject = entry.word ? getWordGroup(entry.word) : null;

  if (followedObject) {
    followedObject.getWorldPosition(desiredTarget);
  } else if (entry.position) {
    desiredTarget.copy(entry.position);
  }
  desiredRadius = entry.radius ?? 6;
});

window.addEventListener("vse:reset-camera", () => {
  resetting = true;
  followedObject = null;
  desiredTarget.set(0, 0, 0);
  desiredRadius = DEFAULT_RADIUS;
});

window.addEventListener("vse:toggle-particles", () => {
  setParticlesVisible(particles, !particles.visible);
});

// ---------------------------------------------------------------- efectos visuales (INSERT/SEARCH/DELETE)

// se cuelgan de wordGroup (no de scene): la posición que viaja en el
// evento es local a wordGroup, que además rota continuamente — si
// colgaran de scene nacerían desalineados y se irían separando del
// punto mientras dura la animación (justo el bug que reportó el usuario)
window.addEventListener("vse:insert-fx", (event) => {
  const { position, color } = event.detail ?? {};
  if (position) spawnInsertBurst(wordGroup, position, color);
});

window.addEventListener("vse:search-fx", (event) => {
  const { position, color } = event.detail ?? {};
  if (position) spawnSearchPulse(wordGroup, position, color);
});

window.addEventListener("vse:delete-fx", (event) => {
  const { position, color } = event.detail ?? {};
  if (position) spawnDeleteImplosion(wordGroup, position, color);
});

// ---------------------------------------------------------------- inicialización de palabras (diferida)

window.addEventListener("vse:words-ready", ({ detail: { placements } }) => {
  initWordDataset(scene, placements);
}, { once: true });

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
const LERP_FACTOR = 0.06;

function tick() {
  const elapsed = clock.getElapsedTime();

  // si hay una palabra enfocada, actualizamos su posición objetivo con
  // su transform actual (sigue a la nube aunque esta siga rotando)
  if (followedObject) {
    followedObject.getWorldPosition(desiredTarget);
  }

  // transición suave del punto orbitado y el radio (foco / reset)
  target.lerp(desiredTarget, LERP_FACTOR);
  radius += (desiredRadius - radius) * LERP_FACTOR;

  if (resetting) {
    theta += (DEFAULT_THETA - theta) * LERP_FACTOR;
    phi += (DEFAULT_PHI - phi) * LERP_FACTOR;
    if (Math.abs(theta - DEFAULT_THETA) < 0.001 && Math.abs(phi - DEFAULT_PHI) < 0.001) {
      resetting = false;
    }
  }

  updateCameraFromSpherical();

  // luces animadas orbitando en colores indigo / cyan
  light1.position.set(Math.cos(elapsed * 0.6) * 14, Math.sin(elapsed * 0.4) * 8, Math.sin(elapsed * 0.6) * 14);
  light2.position.set(Math.sin(elapsed * 0.5) * 14, Math.cos(elapsed * 0.35) * 8, Math.cos(elapsed * 0.5) * 14);

  wordGroup.rotation.y += 0.0008;
  updateWordPulses(elapsed);
  updateConnectionPulses(elapsed);
  updateParticles(particles);
  updateEffects(); // bursts/implosiones/ondas — costo independiente de la cantidad de palabras

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
