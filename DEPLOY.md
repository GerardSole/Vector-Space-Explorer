# Deploy en producción

Stack: **Render** (backend FastAPI) + **Qdrant Cloud** (base de datos vectorial) + **Vercel** (frontend estático).

---

## 1. Qdrant Cloud (base de datos vectorial)

1. Crear cuenta en [cloud.qdrant.io](https://cloud.qdrant.io)
2. **New Cluster → Free tier** (1 GB, suficiente para la demo)
3. Una vez creado, copiar:
   - **Cluster URL** → `https://<id>.europe-west3-0.gcp.cloud.qdrant.io`
   - **API Key** → generada en la pestaña *API Keys*

---

## 2. Render (backend FastAPI)

### Primera vez

1. Crear cuenta en [render.com](https://render.com)
2. **New → Web Service**
3. Conectar el repositorio GitHub del proyecto
4. Render detecta `render.yaml` automáticamente y propone el servicio `vector-space-explorer-api`
5. Confirmar configuración:
   - **Runtime**: Docker
   - **Dockerfile path**: `./backend/Dockerfile`
   - **Instance type**: Free

### Variables de entorno

En *Environment → Environment Variables*, añadir:

| Variable | Valor |
|---|---|
| `COHERE_API_KEY` | tu API key de [cohere.com](https://cohere.com) |
| `QDRANT_URL` | URL del cluster de Qdrant Cloud |
| `QDRANT_API_KEY` | API key de Qdrant Cloud |
| `QDRANT_COLLECTION` | `vectors` |

> `PORT` lo inyecta Render automáticamente — no lo añadas.

### Deploy

Hacer clic en **Deploy**. Render construye la imagen Docker, arranca uvicorn y ejecuta el seed automático (25 palabras → Qdrant Cloud).

La URL del servicio tendrá el formato:
```
https://vector-space-explorer-api.onrender.com
```

---

## 3. Conectar el frontend con el backend de Render

Editar [frontend/js/api.js](frontend/js/api.js) y reemplazar el placeholder:

```js
: "https://tu-backend.onrender.com"   // ← reemplaza con tu URL real
```

Hacer commit y push. Vercel redesplegará el frontend automáticamente.

---

## 4. Deploy automático

Cada `git push` a `main`:
- **Vercel** redespliega el frontend en ~30 s
- **Render** reconstruye la imagen Docker y redespliega el backend en ~3 min

---

## Notas

- El free tier de Render **duerme** tras 15 min de inactividad. La primera petición tras el sleep tarda ~30 s en despertar (cold start). El free tier de Qdrant Cloud no tiene este límite.
- Para evitar el cold start, usar [UptimeRobot](https://uptimerobot.com) con un ping a `GET /` cada 10 min.
- El seed es idempotente: si Qdrant ya tiene datos al arrancar, no hace nada. Para resetear la demo: `POST /api/vectors/seed?force=true`.
