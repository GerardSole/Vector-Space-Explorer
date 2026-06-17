import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import embed, vectors
from services.qdrant import init_collection
from seed import seed as run_seed
from config import PORT, CORS_ORIGINS


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_collection()
    await run_seed()   # no-op si ya hay datos; inserta dataset si está vacío
    yield


app = FastAPI(
    title="Vector Space Explorer API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(embed.router, prefix="/api")
app.include_router(vectors.router, prefix="/api")


@app.get("/")
async def root():
    return {"status": "ok", "version": "1.0"}
