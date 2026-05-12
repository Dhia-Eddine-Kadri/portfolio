"""ai_answer_cache helpers.

Caching is keyed by:
  user_id + course_id + question_hash + document_version_hash

`document_version_hash` is the sha256 of the sorted list of document_hashes
that participated in the answer — so when the user re-uploads a doc, the
hash changes and the answer is regenerated automatically.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from ..supabase_client import get_supabase

log = logging.getLogger(__name__)


def _normalize_question(q: str) -> str:
    """Trim + lowercase + collapse internal whitespace."""
    return " ".join((q or "").lower().split())


def question_hash(q: str) -> str:
    return hashlib.sha256(_normalize_question(q).encode("utf-8")).hexdigest()


def document_version_hash(document_hashes: list[str | None]) -> str:
    """sha256 over the sorted, non-null document_hash list."""
    cleaned = sorted(h for h in document_hashes if h)
    return hashlib.sha256("|".join(cleaned).encode("utf-8")).hexdigest()


def fetch_document_version_hash(user_id: str, course_id: str, document_ids: list[str]) -> str:
    """Resolve document_ids → their document_hash values → version hash."""
    if not document_ids:
        return ""
    sb = get_supabase()
    try:
        resp = (
            sb.table("documents")
            .select("id, document_hash")
            .eq("user_id", user_id)
            .eq("course_id", course_id)
            .in_("id", document_ids)
            .execute()
        )
    except Exception:
        log.exception("fetch document_hashes failed")
        return ""
    hashes = [row.get("document_hash") for row in (resp.data or [])]
    return document_version_hash(hashes)


def lookup_answer(
    *,
    user_id: str,
    course_id: str,
    question: str,
    version_hash: str,
) -> dict[str, Any] | None:
    """Return the cached answer JSON, or None on miss. Bumps usage stats on hit."""
    if not version_hash:
        return None
    q_hash = question_hash(question)
    sb = get_supabase()
    try:
        resp = (
            sb.table("ai_answer_cache")
            .select("id, answer_json")
            .eq("user_id", user_id)
            .eq("course_id", course_id)
            .eq("question_hash", q_hash)
            .eq("document_version_hash", version_hash)
            .limit(1)
            .execute()
        )
    except Exception:
        log.exception("cache lookup failed")
        return None
    rows = resp.data or []
    if not rows:
        return None
    hit = rows[0]
    try:
        sb.table("ai_answer_cache").update({
            "last_used_at": datetime.now(timezone.utc).isoformat(),
            "usage_count":  (hit.get("usage_count") or 0) + 1,
        }).eq("id", hit["id"]).execute()
    except Exception:
        log.warning("cache usage bump failed (non-fatal)")
    return hit["answer_json"]


def save_answer(
    *,
    user_id: str,
    course_id: str,
    question: str,
    version_hash: str,
    answer_json: dict[str, Any],
) -> None:
    """Upsert the answer for next time. Safe to no-op on errors."""
    if not version_hash:
        return
    sb = get_supabase()
    payload = {
        "user_id":               user_id,
        "course_id":             course_id,
        "question_hash":         question_hash(question),
        "normalized_question":   _normalize_question(question),
        "document_version_hash": version_hash,
        "answer_json":           answer_json,
        "last_used_at":          datetime.now(timezone.utc).isoformat(),
    }
    try:
        sb.table("ai_answer_cache").upsert(
            payload,
            on_conflict="user_id,course_id,question_hash,document_version_hash",
        ).execute()
    except Exception:
        log.exception("cache save failed (non-fatal)")
