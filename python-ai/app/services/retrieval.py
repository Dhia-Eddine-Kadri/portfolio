"""Retrieve relevant chunks for a question, with study-value reranking.

Calls the existing `match_chunks_hybrid` RPC (vector + BM25, document
filter aware) and then reranks results by the same study-value heuristics
the JS pipeline already uses: source-type weight, official-material
boost, section-title hints, and text-shape hints (formulas, numbered
lists, "common mistake" markers, etc.).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from ..supabase_client import get_supabase
from .embeddings import embed_texts

log = logging.getLogger(__name__)


# ── Study-value scoring ──────────────────────────────────────────────────────

# Mirror of backend/lib/study-pipeline.js — kept consistent on purpose so a
# given user's chunk ordering is stable across the JS → Python migration.
_SOURCE_BASE = {
    "solution": 0.20,
    "exercise": 0.18,
    "lecture":  0.14,
    "exam":     0.16,
    "notes":    0.08,
    "summary":  0.06,
    "other":    0.0,
}

_HIGH_VALUE_KEYWORDS = (
    "aufgabe", "übung", "übungen", "beispiel", "beispiele", "lösung", "lösungen",
    "definition", "satz", "sätze", "theorem", "formel", "formeln", "formelzettel",
    "formelsammlung", "zusammenfassung", "prüfung", "klausur", "exercise", "example",
    "solution", "formula", "proof", "method", "algorithm", "procedure",
    "wichtig", "merke", "hinweis", "note", "tip", "exam", "summary", "cheatsheet",
)

_FORMULA_TOKEN_RE = re.compile(r"[=≈∑∫∂√π]|\b[a-z]_?\{?[a-z0-9]\}?\s*=")
_NUMBERED_LIST_RE = re.compile(r"^\s*\d+[\.\)]", re.MULTILINE)
_MISTAKE_RE = re.compile(r"fehler|mistake|achtung|attention|nicht verwechseln|do not|never|always", re.I)
_TOC_RE = re.compile(r"^\s*\d+\s*\.{3,}", re.MULTILINE)


def _section_score(section_title: str | None) -> float:
    if not section_title:
        return 0.0
    lower = section_title.lower()
    return 0.20 if any(kw in lower for kw in _HIGH_VALUE_KEYWORDS) else 0.0


def _text_study_score(text: str) -> float:
    if not text:
        return 0.0
    score = 0.0
    lower = text.lower()
    if _FORMULA_TOKEN_RE.search(text):
        score += 0.15
    if _NUMBERED_LIST_RE.search(text):
        score += 0.08
    for kw in _HIGH_VALUE_KEYWORDS:
        if kw in lower:
            score += 0.06
    if _MISTAKE_RE.search(text):
        score += 0.08
    if _TOC_RE.search(text):
        score -= 0.20
    if len(text.strip().split("\n")) < 3 and len(text.strip()) < 80:
        score -= 0.15
    return score


def _study_score(chunk: dict[str, Any]) -> float:
    similarity = chunk.get("similarity") or 0.0
    source = chunk.get("source_type") or "other"
    official = bool(chunk.get("is_official"))
    return (
        similarity
        + _SOURCE_BASE.get(source, 0.0)
        + (0.08 if official else 0.0)
        + _section_score(chunk.get("section_title"))
        + _text_study_score(chunk.get("chunk_text") or "")
    )


# ── Public surface ───────────────────────────────────────────────────────────


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    page_start: int | None
    page_end: int | None
    text: str
    score: float
    similarity: float
    chunk_type: str
    section_title: str | None

    def to_api(self) -> dict[str, Any]:
        return {
            "chunkId": self.chunk_id,
            "documentId": self.document_id,
            "pageStart": self.page_start,
            "pageEnd": self.page_end,
            "text": self.text,
            "score": round(self.score, 4),
            "similarity": round(self.similarity, 4),
            "chunkType": self.chunk_type,
            "sectionTitle": self.section_title,
        }


_DEFAULT_CANDIDATES = 60
_MIN_SIMILARITY = 0.10


def retrieve_chunks(
    *,
    user_id: str,
    course_id: str,
    query: str,
    document_ids: list[str] | None = None,
    top_k: int = 12,
    min_similarity: float = _MIN_SIMILARITY,
) -> list[RetrievedChunk]:
    """Return up to top_k chunks for the question, reranked by study value."""
    if not query.strip():
        return []

    embedding = embed_texts([query])[0]
    sb = get_supabase()

    # Format the vector the way pgvector expects from RPC: "[v1,v2,...]" string.
    payload: dict[str, Any] = {
        "p_user_id":     user_id,
        "p_course_id":   course_id,
        "p_embedding":   "[" + ",".join(f"{v:.7f}" for v in embedding) + "]",
        "p_query":       query,
        "p_match_count": _DEFAULT_CANDIDATES,
        "p_threshold":   min_similarity,
    }
    if document_ids:
        payload["p_document_ids"] = list(document_ids)

    try:
        resp = sb.rpc("match_chunks_hybrid", payload).execute()
    except Exception:
        log.exception("match_chunks_hybrid failed")
        return []

    rows: list[dict[str, Any]] = resp.data or []

    # If the document filter returned nothing, try once more without it as a
    # safety net — same behaviour the JS pipeline already had.
    if not rows and document_ids:
        payload.pop("p_document_ids", None)
        try:
            resp = sb.rpc("match_chunks_hybrid", payload).execute()
            rows = [
                r for r in (resp.data or [])
                if r.get("document_id") in set(document_ids)
            ]
        except Exception:
            log.exception("match_chunks_hybrid (fallback) failed")
            rows = []

    if not rows:
        return []

    # Rerank by study value
    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        ranked.append((_study_score(row), row))
    ranked.sort(key=lambda pair: pair[0], reverse=True)

    chosen = ranked[: max(top_k, 1)]

    # Fetch chunk_type for each in one batch — RPC predates the new column.
    chunk_ids = [r["id"] for _, r in chosen if r.get("id")]
    type_map: dict[str, str] = {}
    if chunk_ids:
        try:
            ct_resp = (
                sb.table("document_chunks")
                .select("id, chunk_type")
                .in_("id", chunk_ids)
                .execute()
            )
            for ct in ct_resp.data or []:
                type_map[ct["id"]] = ct.get("chunk_type") or "general"
        except Exception:
            log.exception("chunk_type lookup failed; defaulting to 'general'")

    return [
        RetrievedChunk(
            chunk_id=row["id"],
            document_id=row["document_id"],
            page_start=row.get("page_start"),
            page_end=row.get("page_end"),
            text=row.get("chunk_text") or "",
            score=score,
            similarity=row.get("similarity") or 0.0,
            chunk_type=type_map.get(row["id"], "general"),
            section_title=row.get("section_title"),
        )
        for score, row in chosen
    ]
