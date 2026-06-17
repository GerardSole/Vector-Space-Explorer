/**
 * particles.js — campo de partículas ambientales de fondo + efectos
 * transitorios de INSERT/SEARCH/DELETE.
 *
 * Campo ambiental: 3000 puntos brillantes distribuidos dentro de una
 * esfera de radio 30, cada uno con su propio tamaño (0.02–0.08), color
 * (mezcla de blanco / indigo / cyan) y opacidad. Usa un ShaderMaterial
 * propio en vez de PointsMaterial porque este último no soporta
 * tamaño ni opacidad por vértice — solo un valor uniforme para todos
 * los puntos. El "glow" de cada punto es una textura de círculo suave
 * generada por canvas (radial gradient), y el depth-fade (partículas
 * lejanas más tenues) se calcula en el fragment shader a partir de la
 * distancia a la cámara.
 *
 * Efectos transitorios (se crean y destruyen en caliente, no afectan
 * el rendimiento con muchas palabras — ver comentario más abajo):
 *   - spawnInsertBurst(scene, position, color)
 *   - spawnDeleteImplosion(scene, position, color)
 *   - spawnSearchPulse(scene, position, color)
 *   - updateEffects() — llamar una vez por frame
 */

import * as THREE from "three";

const PARTICLE_COUNT = 3000;
const SPHERE_RADIUS = 30;
const ROTATION_SPEED = 0.0003; // rad/frame
const BASE_COLORS = [0xffffff, 0x6366f1, 0x06b6d4];

let activePoints = null;

// ---------------------------------------------------------------- glow texture

/**
 * Textura de círculo suave (blanco→transparente), reutilizada por el
 * campo ambiental y por las nebulosas de fondo de scene.js.
 */
export function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------- shaders

const VERTEX_SHADER = /* glsl */ `
  attribute float particleSize;
  attribute float particleAlpha;
  attribute vec3 particleColor;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;

  void main() {
    vColor = particleColor;
    vAlpha = particleAlpha;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPosition.z;

    // tamaño con atenuación por perspectiva (más lejos = más pequeño)
    gl_PointSize = max(1.0, particleSize * (1600.0 / vDepth));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D pointTexture;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;

  void main() {
    vec4 tex = texture2D(pointTexture, gl_PointCoord);

    // depth fade: partículas cercanas a la cámara, opacas;
    // partículas lejanas, progresivamente más tenues
    float depthFade = 1.0 - smoothstep(20.0, 75.0, vDepth);

    gl_FragColor = vec4(vColor, vAlpha * depthFade * tex.a);
  }
`;

// ---------------------------------------------------------------- creación

/**
 * Crea el campo de partículas y lo agrega a la escena.
 * @param {THREE.Scene} scene
 * @returns {THREE.Points}
 */
export function initParticles(scene) {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const alphas = new Float32Array(PARTICLE_COUNT);

  const palette = BASE_COLORS.map((hex) => new THREE.Color(hex));

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // distribución uniforme dentro del volumen de la esfera (no solo
    // en su superficie) para que se sienta como una nube de fondo
    const r = SPHERE_RADIUS * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const color = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = THREE.MathUtils.randFloat(0.02, 0.08);
    alphas[i] = THREE.MathUtils.randFloat(0.3, 1.0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("particleColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("particleSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("particleAlpha", new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      pointTexture: { value: createGlowTexture() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = "background-particles";
  scene.add(points);

  activePoints = points;
  return points;
}

/**
 * Avanza la animación del campo de partículas (rotación lentísima).
 * Debe llamarse una vez por frame desde el loop de render.
 * @param {THREE.Points} [points] por defecto, el último creado con initParticles
 */
export function updateParticles(points = activePoints) {
  if (!points) return;
  points.rotation.y += ROTATION_SPEED;
}

export function setParticlesVisible(points = activePoints, visible) {
  if (points) points.visible = visible;
}

// ================================================================
// Efectos transitorios: INSERT (burst) / SEARCH (onda) / DELETE (implosión)
// ================================================================
//
// A diferencia del campo ambiental (estático, se crea una sola vez),
// estos efectos se crean y destruyen dinámicamente. Su costo es
// O(efectos activos × partículas por efecto) — nunca O(palabras en
// escena) — y se limita la cantidad de efectos simultáneos para que
// spamear INSERT/SEARCH/DELETE no acumule objetos sin límite.

const MAX_CONCURRENT_EFFECTS = 12;
const particleEffects = []; // bursts/implosiones: { points, origin, velocities, gravity, startTime, duration }
const pulseEffects = []; // ondas de SEARCH: { sprite, startTime, duration, maxScale }

let ringTextureCache = null;

function getRingTexture() {
  if (ringTextureCache) return ringTextureCache;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // anillo: transparente en el centro, franja blanca a mitad de radio,
  // transparente otra vez hacia el borde
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.72, "rgba(255,255,255,0.95)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ringTextureCache = new THREE.CanvasTexture(canvas);
  ringTextureCache.needsUpdate = true;
  return ringTextureCache;
}

function disposeParticleEffect(effect) {
  effect.points.geometry.dispose();
  effect.points.material.dispose();
  effect.points.parent?.remove(effect.points);
}

function spawnPointEffect(parent, position, color, options) {
  const { count, duration, speedMin, speedMax, gravity = 0, upwardBias = 0, size } = options;

  if (particleEffects.length >= MAX_CONCURRENT_EFFECTS) {
    disposeParticleEffect(particleEffects.shift()); // descarta el más viejo
  }

  const origin = position.clone();
  const velocities = new Float32Array(count * 3);
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // dirección aleatoria sobre una esfera, con velocidad variable
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const speed = speedMin + Math.random() * (speedMax - speedMin);

    velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
    velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed + upwardBias;
    velocities[i * 3 + 2] = Math.cos(phi) * speed;

    positions[i * 3] = origin.x;
    positions[i * 3 + 1] = origin.y;
    positions[i * 3 + 2] = origin.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    size,
    color,
    transparent: true,
    opacity: 1,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  parent.add(points);

  particleEffects.push({ points, origin, velocities, gravity, startTime: performance.now(), duration });
}

/**
 * INSERT: burst de 20 partículas que explotan desde `position` y se
 * desvanecen en 800ms.
 * @param {THREE.Object3D} parent debe ser wordGroup (no la Scene): la
 *   posición de la palabra es local a wordGroup, que además rota
 *   continuamente — si el efecto colgara de la Scene, nacería
 *   desalineado y se iría separando del punto mientras dura.
 * @param {THREE.Vector3} position
 * @param {string|number} color
 */
export function spawnInsertBurst(parent, position, color = 0xffffff) {
  spawnPointEffect(parent, position, color, {
    count: 20,
    duration: 800,
    speedMin: 1.2,
    speedMax: 3.4,
    gravity: 0,
    size: 0.16,
  });
}

/**
 * DELETE: partículas que saltan brevemente y luego caen por gravedad
 * ("implosión"), mientras el punto principal se achica a 0 en paralelo
 * (ver words.js → updateWordPulses, animación de salida).
 * @param {THREE.Object3D} parent debe ser wordGroup (ver spawnInsertBurst)
 * @param {THREE.Vector3} position
 * @param {string|number} color
 */
export function spawnDeleteImplosion(parent, position, color = 0xffffff) {
  spawnPointEffect(parent, position, color, {
    count: 16,
    duration: 700,
    speedMin: 0.5,
    speedMax: 1.6,
    gravity: 7,
    upwardBias: 0.8,
    size: 0.13,
  });
}

/**
 * SEARCH: anillo que se expande desde `position` y se desvanece —
 * simula una onda de búsqueda propagándose por el espacio vectorial.
 * @param {THREE.Object3D} parent debe ser wordGroup (ver spawnInsertBurst)
 * @param {THREE.Vector3} position
 * @param {string|number} color
 */
export function spawnSearchPulse(parent, position, color = 0xffffff) {
  if (pulseEffects.length >= MAX_CONCURRENT_EFFECTS) {
    const old = pulseEffects.shift();
    old.sprite.material.dispose();
    old.sprite.parent?.remove(old.sprite);
  }

  const material = new THREE.SpriteMaterial({
    map: getRingTexture(),
    color,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(0.3, 0.3, 1);
  parent.add(sprite);

  pulseEffects.push({ sprite, startTime: performance.now(), duration: 900, maxScale: 7 });
}

/**
 * Avanza todos los efectos transitorios activos y libera los que ya
 * terminaron. Llamar una vez por frame desde el loop de render. Costo
 * O(efectos activos), nunca O(palabras en escena) — no afecta el
 * rendimiento con muchas palabras.
 */
export function updateEffects() {
  const now = performance.now();

  for (let i = particleEffects.length - 1; i >= 0; i--) {
    const effect = particleEffects[i];
    const t = (now - effect.startTime) / effect.duration;

    if (t >= 1) {
      disposeParticleEffect(effect);
      particleEffects.splice(i, 1);
      continue;
    }

    // posición absoluta = origen + velocidad·t (+ caída por gravedad si
    // aplica) — frame-rate independiente, no se acumula error
    const elapsedSec = (now - effect.startTime) / 1000;
    const positions = effect.points.geometry.attributes.position;

    for (let p = 0; p < positions.count; p++) {
      const vx = effect.velocities[p * 3];
      const vy = effect.velocities[p * 3 + 1];
      const vz = effect.velocities[p * 3 + 2];
      positions.array[p * 3] = effect.origin.x + vx * elapsedSec;
      positions.array[p * 3 + 1] =
        effect.origin.y + vy * elapsedSec - 0.5 * effect.gravity * elapsedSec * elapsedSec;
      positions.array[p * 3 + 2] = effect.origin.z + vz * elapsedSec;
    }
    positions.needsUpdate = true;
    effect.points.material.opacity = 1 - t;
  }

  for (let i = pulseEffects.length - 1; i >= 0; i--) {
    const effect = pulseEffects[i];
    const t = (now - effect.startTime) / effect.duration;

    if (t >= 1) {
      effect.sprite.material.dispose();
      effect.sprite.parent?.remove(effect.sprite);
      pulseEffects.splice(i, 1);
      continue;
    }

    const eased = 1 - Math.pow(1 - t, 2); // easeOutQuad: se expande rápido al inicio
    const scale = 0.3 + eased * effect.maxScale;
    effect.sprite.scale.set(scale, scale, 1);
    effect.sprite.material.opacity = 1 - t;
  }
}
