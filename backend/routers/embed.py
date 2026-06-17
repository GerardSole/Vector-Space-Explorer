from fastapi import APIRouter, HTTPException
from models import EmbedRequest, EmbedResponse
from services import cohere as cohere_svc

router = APIRouter(tags=["embed"])


@router.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    try:
        embedding = await cohere_svc.get_embedding(req.text.strip())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cohere error: {exc}") from exc
    return EmbedResponse(embedding=embedding)
