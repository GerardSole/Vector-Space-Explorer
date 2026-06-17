from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from services import cohere as cohere_svc
from services import qdrant as qdrant_svc
from seed import seed as run_seed

router = APIRouter(prefix="/vectors", tags=["vectors"])


# ── Request models ─────────────────────────────────────────────────────────────

class InsertRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=100)
    category: str = Field(..., min_length=1, max_length=50)


class SearchRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=100)
    k: int = Field(5, ge=1, le=20)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/insert", status_code=201)
async def insert(req: InsertRequest):
    word = req.word.strip()
    try:
        embedding = await cohere_svc.get_embedding(word)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cohere error: {exc}") from exc

    point_id = await qdrant_svc.insert_vector(
        word=word,
        embedding=embedding,
        category=req.category,
        metadata={},
    )
    return {
        "word": word,
        "category": req.category,
        "vector": embedding,           # vector completo para PCA en el frontend
        "vector_preview": embedding[:6],
        "id": point_id,
        "dimensions": len(embedding),
    }


@router.get("/list")
async def list_vectors():
    entries = await qdrant_svc.list_vectors()
    return [
        {
            "word": e["word"],
            "category": e["category"],
            "vector": e["vector"],           # vector completo para PCA en restore
            "vector_preview": e["vector_preview"],
        }
        for e in entries
    ]


@router.delete("/{word}")
async def delete(word: str):
    success = await qdrant_svc.delete_vector(word)
    return {"success": success, "word": word}


@router.post("/search")
async def search(req: SearchRequest):
    word = req.word.strip()
    try:
        query_vector = await cohere_svc.get_embedding(word)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cohere error: {exc}") from exc

    hits = await qdrant_svc.search_similar(query_vector, k=req.k)
    results = [h for h in hits if h["word"] != word][: req.k]
    return [
        {
            "word": h["word"],
            "category": h["category"],
            "score": round(h["score"], 6),
            "distance": round(1 - h["score"], 6),
        }
        for h in results
    ]


@router.post("/seed")
async def seed(force: bool = False):
    """Fuerza la reinserción del dataset completo. Útil para resetear la demo."""
    try:
        inserted = await run_seed(force=force)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Seed error: {exc}") from exc
    return {
        "inserted": inserted,
        "message": "Dataset reiniciado" if force else ("Seed completado" if inserted > 0 else "Colección ya tenía datos"),
    }


@router.get("/info")
async def collection_info():
    info = await qdrant_svc.get_collection_info()
    return {
        "total_vectors": info["total_vectors"],
        "collection_name": info["collection"],
        "vector_size": info["vector_size"],
        "status": "ok",
    }
