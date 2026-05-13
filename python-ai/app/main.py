"""FastAPI entrypoint for the Minallo AI/RAG service.

Phase 1: only /health and a Supabase smoke test endpoint. No business
logic yet. Routers for /index-document, /ask, etc. are added in later
phases.
"""

import logging
from typing import Any

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_internal_token
from .config import get_settings
from .routers import ask as ask_router
from .routers import chat as chat_router
from .routers import generate as generate_router
from .routers import index as index_router
from .routers import misc as misc_router
from .routers import notes_full as notes_full_router
from .routers import stream as stream_router
from .supabase_client import get_supabase

settings = get_settings()
logging.basicConfig(level=settings.log_level)
log = logging.getLogger("minallo-ai")

app = FastAPI(
    title="Minallo AI Service",
    version="0.6.0",
    description="PDF indexing, retrieval, and grounded answer generation.",
)

# CORS — the streaming /ask-stream endpoint is called directly from the
# browser (bypasses the Netlify proxy so the connection can stay open for
# SSE). Restrict to the production domain + Netlify preview hosts.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://minallo.de",
        "https://www.minallo.de",
        "https://minallo-website.netlify.app",
    ],
    allow_origin_regex=r"^https://deploy-preview-\d+--minallo\.netlify\.app$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Internal-Token", "Accept"],
)

app.include_router(index_router.router)
app.include_router(ask_router.router)
app.include_router(generate_router.router)
app.include_router(stream_router.router)
app.include_router(chat_router.router)
app.include_router(misc_router.router)
app.include_router(notes_full_router.router)


@app.get("/health")
async def health() -> dict[str, Any]:
    """Liveness probe. Unauthenticated on purpose — used by Fly/Netlify."""
    return {
        "status": "ok",
        "service": "minallo-ai",
        "version": app.version,
        "environment": settings.environment,
    }


@app.get("/internal/db-smoke", dependencies=[Depends(require_internal_token)])
async def db_smoke() -> dict[str, Any]:
    """Tiny read against `documents` to confirm Supabase wiring works.

    Returns the count only — no row data. Used during deploy to verify
    the service can reach Postgres with the service-role key.
    """
    sb = get_supabase()
    try:
        # head=True asks Postgres for the count without shipping rows.
        result = sb.table("documents").select("id", count="exact", head=True).execute()
        return {"ok": True, "documents_count": result.count}
    except Exception as e:  # noqa: BLE001 — surface to caller for diagnostics
        log.exception("db smoke failed")
        return {"ok": False, "error": str(e)}
