import os
from dotenv import load_dotenv

load_dotenv()

COHERE_API_KEY: str = os.environ.get("COHERE_API_KEY", "")
QDRANT_URL: str = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY: str | None = os.environ.get("QDRANT_API_KEY") or None  # None = sin auth (local)
QDRANT_COLLECTION: str = os.environ.get("QDRANT_COLLECTION", "vectors")
PORT: int = int(os.environ.get("PORT", 8000))

# CORS_ORIGINS: lista separada por comas, o "*" para permitir todos los orígenes.
# Default "*" es correcto para demos públicas; en producción con auth usar un dominio concreto.
_cors_raw = os.environ.get("CORS_ORIGINS", "*")
CORS_ORIGINS: list[str] = [o.strip() for o in _cors_raw.split(",")]

if not COHERE_API_KEY:
    import warnings
    warnings.warn("COHERE_API_KEY is not set — embed endpoints will fail")
