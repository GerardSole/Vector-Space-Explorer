import hashlib
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    PointIdsList,
    Filter,
    FieldCondition,
    MatchValue,
)
from config import QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION

VECTOR_SIZE = 1024  # embed-multilingual-v3.0

_client: AsyncQdrantClient | None = None


def _get_client() -> AsyncQdrantClient:
    global _client
    if _client is None:
        kwargs = {"url": QDRANT_URL}
        if QDRANT_API_KEY:
            kwargs["api_key"] = QDRANT_API_KEY
        _client = AsyncQdrantClient(**kwargs)
    return _client


def _word_id(word: str) -> int:
    digest = hashlib.sha256(word.encode()).digest()
    return int.from_bytes(digest[:8], "big") >> 1


async def init_collection() -> None:
    client = _get_client()
    existing = await client.get_collections()
    names = {c.name for c in existing.collections}
    if QDRANT_COLLECTION not in names:
        await client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )


async def insert_vector(
    word: str,
    embedding: list[float],
    category: str,
    metadata: dict | None = None,
) -> int:
    client = _get_client()
    point_id = _word_id(word)
    payload = {"word": word, "category": category, "metadata": metadata or {}}
    await client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=[PointStruct(id=point_id, vector=embedding, payload=payload)],
    )
    return point_id


async def search_similar(embedding: list[float], k: int = 5) -> list[dict]:
    client = _get_client()
    result = await client.query_points(
        collection_name=QDRANT_COLLECTION,
        query=embedding,
        limit=k,
        with_payload=True,
        with_vectors=False,
    )
    return [
        {
            "word": h.payload["word"],
            "category": h.payload["category"],
            "score": h.score,
            "payload": h.payload,
        }
        for h in result.points
    ]


async def delete_vector(word: str) -> bool:
    client = _get_client()
    result = await client.delete(
        collection_name=QDRANT_COLLECTION,
        points_selector=Filter(
            must=[FieldCondition(key="word", match=MatchValue(value=word))]
        ),
    )
    return result.status.name == "COMPLETED"


async def list_vectors() -> list[dict]:
    client = _get_client()
    records, _ = await client.scroll(
        collection_name=QDRANT_COLLECTION,
        with_payload=True,
        with_vectors=True,
        limit=1000,
    )
    return [
        {
            "id": r.id,
            "word": r.payload["word"],
            "category": r.payload["category"],
            "vector": r.vector,
            "vector_preview": r.vector[:6],
            "metadata": r.payload.get("metadata", {}),
        }
        for r in records
    ]


async def get_collection_info() -> dict:
    client = _get_client()
    info = await client.get_collection(collection_name=QDRANT_COLLECTION)
    return {
        "collection": QDRANT_COLLECTION,
        "total_vectors": info.points_count,
        "vector_size": info.config.params.vectors.size,
    }
