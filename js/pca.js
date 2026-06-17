/**
 * pca.js — Principal Component Analysis desde cero, sin dependencias.
 *
 * Usa el enfoque "dual" (Gram matrix): en lugar de la matriz de covarianza
 * d×d (d = 1024 dimensiones), se calcula la matriz de Gram n×n donde n es
 * el número de muestras (palabras en escena). Cuando n << d — como aquí,
 * unas pocas decenas de palabras con vectores de 1024 dims — esto es
 * órdenes de magnitud más rápido.
 *
 * Coste total: O(n²·d) para construir Gram + O(n²·iter) para iteración
 * potencia → viable en tiempo real con n ≤ 200.
 */

/** Producto escalar de dos arrays de igual longitud. */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Producto matriz-vector: M (n×n) · v (n) → w (n). */
function matVec(M, v) {
  return M.map((row) => dot(row, v));
}

/** Normaliza a longitud unitaria (devuelve copia; retorna zeros si norma ≈ 0). */
function vecNorm(v) {
  const norm = Math.sqrt(dot(v, v));
  if (norm < 1e-10) return v.map(() => 0);
  return v.map((x) => x / norm);
}

/**
 * Convención de signo: el componente de mayor valor absoluto siempre es
 * positivo. Esto hace que la iteración potencia sea determinista respecto
 * al signo, independientemente del punto de arranque.
 */
function canonicalSign(v) {
  let maxAbs = 0;
  let maxIdx = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i]);
    if (a > maxAbs) { maxAbs = a; maxIdx = i; }
  }
  return v[maxIdx] < 0 ? v.map((x) => -x) : v;
}

/**
 * Reduce un conjunto de vectores de alta dimensión a `dimensions` dims
 * mediante PCA (Análisis de Componentes Principales).
 *
 * @param {number[][]} vectors  n vectores de longitud d (todos igual). n ≥ 2.
 * @param {number}     dimensions  Componentes a retener (≤ n − 1).
 * @returns {number[][]}  n vectores de longitud `dimensions`.
 */
export function pca(vectors, dimensions = 3) {
  const n = vectors.length;
  const d = vectors[0].length;
  if (n < 2) return vectors.map(() => new Array(dimensions).fill(0));

  // ── 1. Centrar: restar la media en cada dimensión ──────────────────
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  const X = vectors.map((v) => v.map((x, j) => x - mean[j]));

  // ── 2. Matriz de Gram G = X · X^T  (n×n) ─────────────────────────
  const G = X.map((xi) => X.map((xj) => dot(xi, xj)));

  // ── 3. Vectores propios de G por iteración potencia + deflación ───
  //   Inicialización determinista con sin(·) para reproducibilidad.
  //   Deflación: tras encontrar v_k, se descuenta su contribución de M
  //   para que la siguiente iteración converja al siguiente v.propio.
  const K = Math.min(dimensions, n - 1);
  const eigenVecs = [];
  let M = G.map((row) => [...row]);

  for (let k = 0; k < K; k++) {
    let v = vecNorm(Array.from({ length: n }, (_, i) => Math.sin((i + 1) * (k + 1) * 1.7853)));

    for (let iter = 0; iter < 300; iter++) {
      const vNext = vecNorm(matVec(M, v));
      // Convergencia: ángulo entre v y vNext < 1e-9 rad (|cos θ| ≈ 1)
      if (1 - Math.abs(dot(v, vNext)) < 1e-9) { v = vNext; break; }
      v = vNext;
    }

    v = canonicalSign(v);
    const lambda = dot(v, matVec(M, v));
    eigenVecs.push(v);

    // Deflación: M ← M − λ · v · v^T
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        M[i][j] -= lambda * v[i] * v[j];
  }

  // Rellena con zeros si n − 1 < dimensions (poco probable en uso real)
  while (eigenVecs.length < dimensions) eigenVecs.push(new Array(n).fill(0));

  // ── 4. Recuperar direcciones PC en el espacio d-dimensional ───────
  //   u_k = X^T · v_k,  normalizado a longitud unitaria.
  //   (Relación entre vectores propios de G y de X^T·X.)
  const PCs = eigenVecs.map((v) => {
    const u = new Array(d).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) u[j] += v[i] * X[i][j];
    return vecNorm(u);
  });

  // ── 5. Proyectar: Y[i][k] = X[i] · PC_k ──────────────────────────
  return X.map((xi) => PCs.map((pc) => dot(xi, pc)));
}

/**
 * Escala coordenadas PCA para que quepan en [−range, +range],
 * preservando la proporción relativa entre todos los ejes.
 *
 * @param {number[][]} coords  Salida de pca()
 * @param {number}     range   Semirango destino (default 7, misma escala
 *   que las palabras sembradas en escena)
 * @returns {number[][]}
 */
export function normalizeProjection(coords, range = 7) {
  let maxAbs = 0;
  for (const p of coords) for (const v of p) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a; }
  if (maxAbs < 1e-10) return coords;
  const scale = range / maxAbs;
  return coords.map((p) => p.map((v) => v * scale));
}
