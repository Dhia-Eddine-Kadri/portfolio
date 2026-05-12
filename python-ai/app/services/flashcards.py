"""Flashcard generation with exact-count retry + study-value bias."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from .llm_json import chat_json
from .retrieval import RetrievedChunk, retrieve_chunks
from ..supabase_client import get_supabase

log = logging.getLogger(__name__)


# Two attempts max — keeps wall-clock under Fly's ~60s HTTP idle timeout
# even for the largest flashcard sets.
_MAX_RETRIES = 2
_VALID_DIFFICULTIES = {"easy", "medium", "hard"}


def _system_prompt(count: int) -> str:
    return f"""You are an expert tutor preparing {count} exam-quality flashcards for a university student.

Generate EXACTLY {count} cards from the COURSE CONTEXT below.

Card types (mix them):
- definition: term → precise definition + notation
- formula: "What is the formula for X?" → formula + meaning of every symbol
- when_to_use: "When do you use method X?" → conditions + reasoning
- method_steps: "How do you solve X step-by-step?" → numbered steps
- common_mistake: typical pitfall → correct approach
- comparison: X vs Y → side-by-side
- mini_exercise: short problem → full worked solution
- notation: professor's symbol → meaning + usage

Rules:
1. Every card must be grounded in the context.
2. Prefer formulas, definitions, theorems, worked examples, common mistakes.
3. Back must be substantial — not a one-word answer.
4. Use the source's notation/terminology.
5. Math in KaTeX: $...$ inline, $$...$$ display.
6. Cite source as "filename, p.N".
7. Match the language of the source material.

CRITICAL: produce EXACTLY {count} items in "items".

Return ONLY valid JSON in this exact shape (no markdown fence, no commentary):
{{
  "items": [
    {{
      "front": "question / term",
      "back":  "answer / explanation",
      "tags":  ["definition", "formula"],
      "difficulty": "easy|medium|hard",
      "source": "filename, p.X"
    }}
  ]
}}"""


def _normalize(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    front = (item.get("front") or "").strip()
    back = (item.get("back") or "").strip()
    if len(front) < 3 or len(back) < 3:
        return None
    difficulty = item.get("difficulty") if item.get("difficulty") in _VALID_DIFFICULTIES else "medium"
    tags = item.get("tags")
    if not isinstance(tags, list):
        tags = []
    tags = [str(t).strip() for t in tags if str(t).strip()]
    return {
        "front": front,
        "back": back,
        "tags": tags,
        "difficulty": difficulty,
        "source": (item.get("source") or "").strip(),
    }


def _context_block(chunks: list[RetrievedChunk], doc_names: dict[str, str]) -> str:
    parts: list[str] = []
    for i, c in enumerate(chunks, 1):
        file_name = doc_names.get(c.document_id, "Unknown")
        pages = (
            f"p.{c.page_start}"
            if c.page_start and c.page_start == c.page_end
            else (f"pp.{c.page_start}-{c.page_end}" if c.page_start and c.page_end else "no-page")
        )
        head = f"[Source {i}] {file_name}, {pages}"
        if c.section_title:
            head += f"\nSection: {c.section_title}"
        parts.append(f"{head}\n{c.text}")
    return "\n\n---\n\n".join(parts)


def generate_flashcards(
    *,
    user_id: str,
    course_id: str,
    document_ids: list[str] | None,
    requested_count: int,
    doc_names: dict[str, str],
) -> dict[str, Any]:
    requested = max(1, min(int(requested_count or 1), 30))

    chunks = retrieve_chunks(
        user_id=user_id, course_id=course_id,
        query="definitions formulas theorems examples exercises common mistakes important concepts",
        document_ids=document_ids,
        top_k=max(20, requested * 2),
    )
    if not chunks:
        return {
            "requestedCount": requested,
            "actualCount": 0,
            "cards": [],
            "warning": "No relevant material found in the selected documents.",
        }

    context = _context_block(chunks, doc_names)
    collected: list[dict[str, Any]] = []
    seen_fronts: set[str] = set()
    diagnostics = {"prompt_tokens": 0, "completion_tokens": 0, "model": None}

    needed = requested
    last_error: str | None = None
    for attempt in range(_MAX_RETRIES):
        if needed <= 0:
            break
        avoid = ""
        if collected:
            avoid = "\n\nDO NOT repeat or paraphrase these card fronts:\n" + "\n".join(
                "- " + (c.get("front") or "")[:140] for c in collected
            )
        # Per-attempt completion budget. Each card runs ~200-350 tokens.
        # Capped so the OpenAI call finishes well under Fly's proxy idle
        # timeout (~60s). The second attempt only fills the shortfall.
        max_completion = min(5000, 1000 + needed * 350)
        try:
            res = chat_json(
                system=_system_prompt(needed) + avoid,
                user="COURSE CONTEXT:\n\n" + context,
                max_tokens=max_completion,
            )
        except Exception as e:  # noqa: BLE001
            last_error = f"{type(e).__name__}: {e}"
            log.exception("flashcards LLM call failed on attempt %s", attempt + 1)
            break

        diagnostics["model"] = res.model
        diagnostics["prompt_tokens"] += res.prompt_tokens or 0
        diagnostics["completion_tokens"] += res.completion_tokens or 0

        raw_items = res.data.get("items") if isinstance(res.data, dict) else None
        if not isinstance(raw_items, list):
            continue

        for raw in raw_items:
            norm = _normalize(raw)
            if not norm:
                continue
            key = re.sub(r"\W+", " ", norm["front"].lower()).strip()
            if not key or key in seen_fronts:
                continue
            seen_fronts.add(key)
            collected.append(norm)
            if len(collected) >= requested:
                break

        needed = requested - len(collected)

    collected = collected[:requested]
    result = {
        "requestedCount": requested,
        "actualCount": len(collected),
        "cards": collected,
        "model": diagnostics["model"],
        "promptTokens": diagnostics["prompt_tokens"],
        "completionTokens": diagnostics["completion_tokens"],
    }
    if len(collected) < requested:
        msg = (
            f"Only {len(collected)} strong flashcards could be created from the selected "
            f"document context (requested {requested})."
        )
        if last_error:
            msg += f" (last error: {last_error})"
        result["warning"] = msg
    return result


def save_flashcard_set(
    *,
    user_id: str,
    course_id: str,
    document_ids: list[str] | None,
    name: str,
    cards: list[dict[str, Any]],
) -> str | None:
    if not cards:
        return None
    sb = get_supabase()
    try:
        set_row = sb.table("study_sets").insert({
            "user_id":      user_id,
            "course_id":    course_id,
            "tool":         "flashcards",
            "name":         name[:120],
            "document_ids": document_ids or None,
            "item_count":   len(cards),
            "updated_at":   datetime.now(timezone.utc).isoformat(),
        }).execute()
        set_id = set_row.data[0]["id"]
        item_rows = [
            {
                "set_id":    set_id,
                "user_id":   user_id,
                "position":  idx,
                "item_data": card,
                "source":    card.get("source"),
                "difficulty": card.get("difficulty"),
            }
            for idx, card in enumerate(cards)
        ]
        sb.table("study_items").insert(item_rows).execute()
        return set_id
    except Exception:
        log.exception("save_flashcard_set failed")
        return None
