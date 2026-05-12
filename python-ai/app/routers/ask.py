"""POST /retrieve-context and POST /ask.

Both guarded by the internal-token dependency. user_id is the
JWT-derived value passed in by the Netlify proxy and is cross-checked
against every document referenced in the request, so a request can
never escape the requesting user's own data.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import require_internal_token
from ..services.answer import generate_answer
from ..services.cache import fetch_document_version_hash, lookup_answer, save_answer
from ..services.retrieval import retrieve_chunks
from ..supabase_client import get_supabase

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="",
    tags=["ask"],
    dependencies=[Depends(require_internal_token)],
)

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _require_uuid(value: str, label: str) -> None:
    if not value or not _UUID_RE.match(value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label} must be a UUID")


def _verify_user_owns_documents(user_id: str, course_id: str, document_ids: list[str] | None) -> dict[str, str]:
    """Confirm every requested document belongs to this user+course.

    Returns id → file_name map for the documents that exist. Raises 404 on
    any mismatch — we deliberately don't 403 so we don't leak existence
    info about other users' rows.
    """
    if not document_ids:
        return {}
    sb = get_supabase()
    resp = (
        sb.table("documents")
        .select("id, user_id, course_id, file_name")
        .in_("id", document_ids)
        .execute()
    )
    rows = resp.data or []
    if len(rows) != len(document_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="document not found")
    for row in rows:
        if row["user_id"] != user_id or row["course_id"] != course_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="document not found")
    return {row["id"]: row["file_name"] for row in rows}


# ── /retrieve-context ────────────────────────────────────────────────────────


class RetrieveContextRequest(BaseModel):
    userId: str
    courseId: str
    documentIds: list[str] | None = None
    query: str
    mode: str = "answer"
    topK: int = 12


class RetrievedChunkPayload(BaseModel):
    chunkId: str
    documentId: str
    pageStart: int | None = None
    pageEnd: int | None = None
    text: str
    score: float
    similarity: float
    chunkType: str
    sectionTitle: str | None = None


class RetrieveContextResponse(BaseModel):
    chunks: list[RetrievedChunkPayload]


@router.post("/retrieve-context", response_model=RetrieveContextResponse)
async def retrieve_context_endpoint(payload: RetrieveContextRequest) -> RetrieveContextResponse:
    _require_uuid(payload.userId, "userId")
    if payload.documentIds:
        for did in payload.documentIds:
            _require_uuid(did, "documentId")
    _verify_user_owns_documents(payload.userId, payload.courseId, payload.documentIds)

    chunks = retrieve_chunks(
        user_id=payload.userId,
        course_id=payload.courseId,
        query=payload.query,
        document_ids=payload.documentIds,
        top_k=max(1, min(payload.topK, 40)),
    )
    return RetrieveContextResponse(chunks=[RetrievedChunkPayload(**c.to_api()) for c in chunks])


# ── /ask ─────────────────────────────────────────────────────────────────────


class AskRequest(BaseModel):
    userId: str
    courseId: str
    documentIds: list[str] | None = Field(default=None, description="Optional filter; required for grounded answers in practice.")
    question: str
    bypassCache: bool = False


class AskSourcePayload(BaseModel):
    fileName: str
    pageStart: int | None = None
    pageEnd: int | None = None
    sectionTitle: str | None = None
    chunkType: str | None = None
    similarity: float | None = None


class AskResponse(BaseModel):
    answer: str
    retrievalMode: str             # strong | weak | none
    groundedSources: list[AskSourcePayload]
    cacheHit: bool
    model: str | None = None
    promptTokens: int | None = None
    completionTokens: int | None = None


@router.post("/ask", response_model=AskResponse)
async def ask_endpoint(payload: AskRequest) -> AskResponse:
    _require_uuid(payload.userId, "userId")
    if payload.documentIds:
        for did in payload.documentIds:
            _require_uuid(did, "documentId")
    doc_name_map = _verify_user_owns_documents(payload.userId, payload.courseId, payload.documentIds)

    question = (payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="question is required")

    # ── 1. Cache lookup (skipped if no document scope or explicitly bypassed) ─
    version_hash = ""
    if payload.documentIds and not payload.bypassCache:
        version_hash = fetch_document_version_hash(
            payload.userId, payload.courseId, payload.documentIds
        )
        cached = lookup_answer(
            user_id=payload.userId,
            course_id=payload.courseId,
            question=question,
            version_hash=version_hash,
        )
        if cached:
            return AskResponse(
                answer=cached.get("answer", ""),
                retrievalMode=cached.get("retrievalMode", "strong"),
                groundedSources=[AskSourcePayload(**s) for s in cached.get("groundedSources", [])],
                cacheHit=True,
                model=cached.get("model"),
                promptTokens=cached.get("promptTokens"),
                completionTokens=cached.get("completionTokens"),
            )

    # ── 2. Retrieve ──────────────────────────────────────────────────────────
    chunks = retrieve_chunks(
        user_id=payload.userId,
        course_id=payload.courseId,
        query=question,
        document_ids=payload.documentIds,
        top_k=12,
    )

    # Backfill doc_name_map for any chunk pointing at a doc we didn't ask
    # about explicitly (e.g. when documentIds is None and we let retrieval
    # roam over the whole course).
    missing_ids = [c.document_id for c in chunks if c.document_id not in doc_name_map]
    if missing_ids:
        sb = get_supabase()
        try:
            resp = sb.table("documents").select("id, file_name").in_("id", list(set(missing_ids))).execute()
            for row in resp.data or []:
                doc_name_map[row["id"]] = row["file_name"]
        except Exception:
            log.exception("doc_name backfill failed")

    # ── 3. Generate ──────────────────────────────────────────────────────────
    try:
        answer = generate_answer(
            question=question,
            chunks=chunks,
            doc_names=doc_name_map,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("answer generation failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"answer generation failed: {e}")

    # ── 4. Save to cache for next time ───────────────────────────────────────
    if version_hash and not payload.bypassCache:
        save_answer(
            user_id=payload.userId,
            course_id=payload.courseId,
            question=question,
            version_hash=version_hash,
            answer_json=answer,
        )

    return AskResponse(
        answer=answer["answer"],
        retrievalMode=answer["retrievalMode"],
        groundedSources=[AskSourcePayload(**s) for s in answer.get("groundedSources", [])],
        cacheHit=False,
        model=answer.get("model"),
        promptTokens=answer.get("promptTokens"),
        completionTokens=answer.get("completionTokens"),
    )
