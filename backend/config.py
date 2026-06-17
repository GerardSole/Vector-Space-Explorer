import os
from dotenv import load_dotenv

load_dotenv()

COHERE_API_KEY: str = os.environ.get("COHERE_API_KEY", "")
QDRANT_URL: str = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY: str | None = os.environ.get("QDRANT_API_KEY") or None  # None = sin auth (local)
QDRANT_COLLECTION: str = os.environ.get("QDRANT_COLLECTION", "vectors")
PORT: int = int(os.environ.get("PORT", 8000))

if not COHERE_API_KEY:
    import warnings
    warnings.warn("COHERE_API_KEY is not set — embed endpoints will fail")
