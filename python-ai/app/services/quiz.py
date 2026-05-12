"""Quiz generation with strict count validation + targeted retry.

Behaviour the brief mandates:
  - Retrieve enough relevant chunks for the requested count.
  - Generate exactly `requestedCount` items. If short, retry only for the
    deficit (not the whole batch) until we either hit the count, run out
    of retries, or run out of context. Surface a warning if we couldn't
    reach the exact count — never fail silently.
  - Validate item shape before counting (no half-items, no duplicates).
  - Save the produced set into study_sets + study_items for the existing
    JS frontend to consume.
"""

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


# Two attempts max — the first asks for the full count with a generous
# token budget; the second backfills only the shortfall. Keeps wall-clock
# under Fly's ~60s HTTP idle timeout even for the largest quizzes.
_MAX_RETRIES = 2
_LETTERS = ("A", "B", "C", "D")
_VALID_TYPES = {"mcq", "true_false", "short_answer"}
_DEFAULT_TYPES = ["mcq", "true_false", "short_answer"]


# ── Prompts ──────────────────────────────────────────────────────────────────

def _system_prompt(count: int, difficulty: str, types: list[str]) -> str:
    diff_guide = {
        "easy":   "Mostly definition recall and single-step identification.",
        "medium": "Mix of concept application, formula use, and 1-step calculations.",
        "hard":   "Multi-step reasoning, formula application, spotting wrong steps. Tough but fair.",
        "mixed":  "Balanced spread across easy, medium, and hard.",
    }.get(difficulty, "Balanced.")

    return f"""You are an expert university professor writing an exam-quality quiz for a student.

Generate EXACTLY {count} questions from the COURSE CONTEXT below.

Question types to draw from: {", ".join(types)}.
Difficulty target: {difficulty} — {diff_guide}

Rules:
1. Every question must be answerable from the context alone. Never invent facts or values.
2. Prefer high-value material: definitions, theorems, formulas, worked examples, exercises.
3. For MCQ: distractors must be plausible, not obviously wrong.
4. For true_false: include a brief explanation; do not write trivially-obvious statements.
5. For short_answer: write an answer key that an exam marker would accept.
6. Cite the source like "filename, p.N" using the [Source N] header for every item.
7. Math in KaTeX: $...$ inline, $$...$$ display.
8. Match the language of the context (German if the slides are German).

CRITICAL: emit EXACTLY {count} items in "items". Do not stop short. Do not pad with junk — quality must hold.

Return ONLY valid JSON in this exact shape (no markdown fence, no commentary):
{{
  "items": [
    {{
      "type": "mcq",
      "question": "...",
      "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
      "answer": "A",
      "explanation": "...",
      "difficulty": "easy|medium|hard",
      "source": "filename, p.X"
    }},
    {{
      "type": "true_false",
      "question": "...",
      "answer": true,
      "explanation": "...",
      "difficulty": "easy|medium|hard",
      "source": "filename, p.X"
    }},
    {{
      "type": "short_answer",
      "question": "...",
      "answer": "expected key answer",
      "explanation": "...",
      "difficulty": "easy|medium|hard",
      "source": "filename, p.X"
    }}
  ]
}}"""


# ── Normalisation + de-dup ───────────────────────────────────────────────────

def _normalize(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    qtype = (item.get("type") or "").strip().lower()
    if qtype not in _VALID_TYPES:
        return None
    question = (item.get("question") or "").strip()
    if len(question) < 5:
        return None
    answer = item.get("answer")
    explanation = (item.get("explanation") or "").strip()
    source = (item.get("source") or "").strip()
    difficulty = item.get("difficulty") if item.get("difficulty") in ("easy", "medium", "hard") else "medium"

    if qtype == "mcq":
        opts_in = item.get("options")
        if not isinstance(opts_in, dict):
            return None
        options = {l: str(opts_in.get(l) or "").strip() for l in _LETTERS}
        for l in _LETTERS:
            if not options[l]:
                options[l] = "—"
        # Tolerate "A) text" / numeric index / option-text answer formats.
        if isinstance(answer, str):
            m = re.match(r"^\s*([A-D])\b", answer)
            if m:
                answer = m.group(1).upper()
            else:
                lower = answer.strip().lower()
                hit = next((l for l in _LETTERS if options[l].strip().lower() == lower), None)
                answer = hit or ""
        elif isinstance(answer, int):
            answer = _LETTERS[answer] if 0 <= answer < 4 else ""
        if answer not in _LETTERS:
            return None
        return {
            "type": "mcq",
            "question": question,
            "options": options,
            "answer": answer,
            "explanation": explanation,
            "difficulty": difficulty,
            "source": source,
        }

    if qtype == "true_false":
        if isinstance(answer, str):
            v = answer.strip().lower()
            if v in ("true", "wahr", "yes", "ja"):
                answer = True
            elif v in ("false", "falsch", "no", "nein"):
                answer = False
            else:
                return None
        if not isinstance(answer, bool):
            return None
        return {
            "type": "true_false",
            "question": question,
            "answer": answer,
            "explanation": explanation,
            "difficulty": difficulty,
            "source": source,
        }

    if qtype == "short_answer":
        if not isinstance(answer, str) or not answer.strip():
            return None
        return {
            "type": "short_answer",
            "question": question,
            "answer": answer.strip(),
            "explanation": explanation,
            "difficulty": difficulty,
            "source": source,
        }

    return None


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for it in items:
        key = (it.get("question") or "").lower().strip()
        key = re.sub(r"\W+", " ", key).strip()
        if key and key not in seen:
            seen.add(key)
            out.append(it)
    return out


# ── Public surface ───────────────────────────────────────────────────────────


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


def generate_quiz(
    *,
    user_id: str,
    course_id: str,
    document_ids: list[str] | None,
    requested_count: int,
    difficulty: str,
    question_types: list[str] | None,
    doc_names: dict[str, str],
) -> dict[str, Any]:
    requested = max(1, min(int(requested_count or 1), 20))
    diff = difficulty if difficulty in ("easy", "medium", "hard", "mixed") else "medium"
    types = [t for t in (question_types or _DEFAULT_TYPES) if t in _VALID_TYPES] or _DEFAULT_TYPES

    chunks = retrieve_chunks(
        user_id=user_id, course_id=course_id,
        query="quiz question key concepts definitions formulas exercises solutions",
        document_ids=document_ids,
        top_k=max(20, requested * 3),
    )
    if not chunks:
        return {
            "requestedCount": requested,
            "actualCount": 0,
            "questions": [],
            "warning": "No relevant material found in the selected documents.",
        }

    context = _context_block(chunks, doc_names)
    collected: list[dict[str, Any]] = []
    seen_questions: set[str] = set()
    diagnostics: dict[str, Any] = {"prompt_tokens": 0, "completion_tokens": 0, "model": None}

    needed = requested
    last_error: str | None = None
    for attempt in range(_MAX_RETRIES):
        if needed <= 0:
            break
        # Tell the model what's already taken so it doesn't repeat itself.
        avoid_block = ""
        if collected:
            avoid_block = "\n\nDO NOT repeat or paraphrase these already-used questions:\n" + "\n".join(
                "- " + (it.get("question") or "")[:160] for it in collected
            )
        system = _system_prompt(needed, diff, types) + avoid_block
        # Per-attempt completion budget — each MCQ with options + explanation
        # + source runs ~250-400 tokens. Capped at 6000 so the OpenAI call
        # finishes well under Fly's ~60s proxy idle timeout (gpt-4o-mini
        # generates ~80 tok/s, so 6000 tokens is ~75s — uncomfortable. Cap
        # tighter at 5000.) The second attempt only fills the shortfall.
        max_completion = min(5000, 1000 + needed * 380)
        try:
            res = chat_json(
                system=system,
                user="COURSE CONTEXT:\n\n" + context,
                max_tokens=max_completion,
            )
        except Exception as e:  # noqa: BLE001
            last_error = f"{type(e).__name__}: {e}"
            log.exception("quiz LLM call failed on attempt %s", attempt + 1)
            break

        diagnostics["model"] = res.model
        diagnostics["prompt_tokens"] += res.prompt_tokens or 0
        diagnostics["completion_tokens"] += res.completion_tokens or 0

        raw_items = res.data.get("items") if isinstance(res.data, dict) else None
        log.info(
            "quiz attempt %s: model returned %s raw items; keys=%s",
            attempt + 1,
            len(raw_items) if isinstance(raw_items, list) else "n/a",
            list(res.data.keys()) if isinstance(res.data, dict) else "non-dict",
        )
        if not isinstance(raw_items, list):
            continue

        new_items: list[dict[str, Any]] = []
        rejected = 0
        for raw in raw_items:
            norm = _normalize(raw)
            if not norm:
                rejected += 1
                if rejected <= 2:  # log first couple of rejections per attempt
                    log.info("quiz item rejected (type=%r answer=%r): %.200s",
                             (raw or {}).get("type") if isinstance(raw, dict) else None,
                             (raw or {}).get("answer") if isinstance(raw, dict) else None,
                             json.dumps(raw, ensure_ascii=False, default=str) if raw else "")
                continue
            key = re.sub(r"\W+", " ", (norm["question"] or "").lower()).strip()
            if not key or key in seen_questions:
                continue
            seen_questions.add(key)
            new_items.append(norm)
            if len(collected) + len(new_items) >= requested:
                break

        log.info("quiz attempt %s: kept=%s rejected=%s", attempt + 1, len(new_items), rejected)
        collected.extend(new_items[: requested - len(collected)])
        needed = requested - len(collected)

    collected = _dedupe(collected)[:requested]

    result: dict[str, Any] = {
        "requestedCount": requested,
        "actualCount": len(collected),
        "questions": collected,
        "model": diagnostics["model"],
        "promptTokens": diagnostics["prompt_tokens"],
        "completionTokens": diagnostics["completion_tokens"],
    }
    if len(collected) < requested:
        msg = (
            f"Only {len(collected)} strong questions could be created from the selected "
            f"document context (requested {requested})."
        )
        if last_error:
            msg += f" (last error: {last_error})"
        result["warning"] = msg
    return result


# ── Persistence ──────────────────────────────────────────────────────────────

def save_quiz_set(
    *,
    user_id: str,
    course_id: str,
    document_ids: list[str] | None,
    name: str,
    difficulty: str,
    questions: list[dict[str, Any]],
) -> str | None:
    """Insert into study_sets + study_items so the existing frontend can load it."""
    if not questions:
        return None
    sb = get_supabase()
    try:
        set_row = sb.table("study_sets").insert({
            "user_id":      user_id,
            "course_id":    course_id,
            "tool":         "quiz",
            "name":         name[:120],
            "difficulty":   difficulty,
            "document_ids": document_ids or None,
            "item_count":   len(questions),
            "updated_at":   datetime.now(timezone.utc).isoformat(),
        }).execute()
        set_id = set_row.data[0]["id"]
        item_rows = [
            {
                "set_id":    set_id,
                "user_id":   user_id,
                "position":  idx,
                "item_data": q,
                "source":    q.get("source"),
                "difficulty": q.get("difficulty"),
            }
            for idx, q in enumerate(questions)
        ]
        sb.table("study_items").insert(item_rows).execute()
        return set_id
    except Exception:
        log.exception("save_quiz_set failed")
        return None
