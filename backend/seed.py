"""
seed.py — Inserta el dataset inicial de 25 palabras en Qdrant.

Idempotente: si la colección ya tiene datos no hace nada.
Se llama automáticamente desde main.py al arrancar (colección vacía)
y también puede ejecutarse directamente:

    python seed.py                  # respeta la idempotencia
    python seed.py --force          # borra y reinserta aunque haya datos
"""

import asyncio
import argparse
import sys
from services.cohere import get_embedding
from services.qdrant import init_collection, insert_vector, get_collection_info, _get_client
from config import QDRANT_COLLECTION

DATASET = [
    # (word, category)
    ("amor",       "emotion"),
    ("alegría",    "emotion"),
    ("tristeza",   "emotion"),
    ("miedo",      "emotion"),
    ("nostalgia",  "emotion"),
    ("esperanza",  "emotion"),
    ("océano",     "nature"),
    ("bosque",     "nature"),
    ("montaña",    "nature"),
    ("lluvia",     "nature"),
    ("sol",        "nature"),
    ("tormenta",   "nature"),
    ("perro",      "animal"),
    ("gato",       "animal"),
    ("lobo",       "animal"),
    ("águila",     "animal"),
    ("delfín",     "animal"),
    ("libro",      "object"),
    ("música",     "object"),
    ("ciudad",     "object"),
    ("silencio",   "object"),
    ("madre",      "person"),
    ("amigo",      "person"),
    ("héroe",      "person"),
    ("sueño",      "emotion"),
]


async def seed(force: bool = False) -> int:
    """
    Inserta el dataset en Qdrant.

    Returns el número de palabras insertadas (0 si ya había datos y force=False).
    """
    await init_collection()

    if not force:
        info = await get_collection_info()
        if info["total_vectors"] > 0:
            print(f"  colección '{QDRANT_COLLECTION}' ya tiene {info['total_vectors']} vectores — omitiendo seed")
            return 0

    if force:
        # Borra la colección entera y la recrea limpia
        client = _get_client()
        await client.delete_collection(collection_name=QDRANT_COLLECTION)
        await init_collection()
        print(f"  colección '{QDRANT_COLLECTION}' reiniciada")

    total = len(DATASET)
    inserted = 0
    errors = []

    for i, (word, category) in enumerate(DATASET, start=1):
        print(f"  Insertando '{word}' ({i}/{total})…", end=" ", flush=True)
        try:
            embedding = await get_embedding(word)
            await insert_vector(word=word, embedding=embedding, category=category)
            print("✓")
            inserted += 1
        except Exception as exc:
            print(f"✗  {exc}")
            errors.append(word)

    print(f"\n✓ Dataset inicializado: {inserted}/{total} vectores en Qdrant")
    if errors:
        print(f"  ✗ Fallaron: {', '.join(errors)}")

    return inserted


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Siembra el dataset inicial en Qdrant")
    parser.add_argument("--force", action="store_true", help="Borra y reinserta aunque haya datos")
    args = parser.parse_args()

    result = asyncio.run(seed(force=args.force))
    sys.exit(0 if result >= 0 else 1)
