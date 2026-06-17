// Centraliza todas las llamadas al backend FastAPI.
// En localhost apunta al servidor local; en producción, al dominio de Render.

const API_URL =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000"
    : "https://tu-backend.onrender.com"; // TODO: reemplaza con la URL real de Render

async function _request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** POST /api/vectors/insert — embede + guarda en Qdrant.
 *  @returns {{ word, category, vector: number[], vector_preview: number[], id, dimensions }} */
export async function insertWord(word, category) {
  return _request("/api/vectors/insert", {
    method: "POST",
    body: JSON.stringify({ word, category }),
  });
}

/** POST /api/vectors/search — busca los k vectores más similares.
 *  @returns {Array<{ word, category, score, distance }>} ordenados por similitud */
export async function searchSimilar(word, k) {
  return _request("/api/vectors/search", {
    method: "POST",
    body: JSON.stringify({ word, k }),
  });
}

/** DELETE /api/vectors/{word} — elimina el vector de esa palabra.
 *  @returns {{ success: bool, word }} */
export async function deleteWord(word) {
  return _request(`/api/vectors/${encodeURIComponent(word)}`, {
    method: "DELETE",
  });
}

/** GET /api/vectors/list — todos los vectores almacenados.
 *  @returns {Array<{ word, category, vector: number[], vector_preview: number[] }>} */
export async function listVectors() {
  return _request("/api/vectors/list");
}

/** GET /api/vectors/info — info de la colección Qdrant.
 *  @returns {{ total_vectors, collection_name, vector_size, status }} */
export async function getCollectionInfo() {
  return _request("/api/vectors/info");
}
