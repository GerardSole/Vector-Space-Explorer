import cohere
from config import COHERE_API_KEY

_client: cohere.AsyncClientV2 | None = None

EMBED_MODEL = "embed-multilingual-v3.0"


def _get_client() -> cohere.AsyncClientV2:
    global _client
    if _client is None:
        _client = cohere.AsyncClientV2(api_key=COHERE_API_KEY)
    return _client


async def get_embedding(text: str) -> list[float]:
    client = _get_client()
    response = await client.embed(
        texts=[text],
        model=EMBED_MODEL,
        input_type="search_document",
        embedding_types=["float"],
    )
    return response.embeddings.float_[0]
