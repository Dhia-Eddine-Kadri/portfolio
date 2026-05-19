"""Streaming variant of generate_answer.

Yields Server-Sent Event payloads as OpenAI returns tokens, then a
terminal `done` event with the full source list + token diagnostics.
The browser fetches this endpoint directly with the user's Supabase
JWT — no Netlify hop, so the connection stays open for the streaming
duration without hitting Netlify's 30s function timeout.

Event schema (newline-delimited JSON inside an SSE `data:` field):
  {"t": "Newton"}                          — token to append
  {"done": true, "sources": [...], ...}    — final metadata
  {"error": "..."}                         — fatal error
"""

from __future__ import annotations

import json
import logging
from typing import Any, Generator

from openai import OpenAI

from ..config import get_settings
from .answer import (
    DEFAULT_TUTOR_MODE,
    _build_context_block,
    _cited_indices,
    _context_strength,
    normalise_tutor_mode,
    pick_system_prompt,
)
from .retrieval import RetrievedChunk

log = logging.getLogger(__name__)


def _sse(event: dict[str, Any]) -> bytes:
    return ("data: " + json.dumps(event, ensure_ascii=False) + "\n\n").encode("utf-8")


def stream_answer(
    *,
    question: str,
    chunks: list[RetrievedChunk],
    doc_names: dict[str, str],
    model: str | None = None,
    max_tokens: int = 1200,
    active_file_name: str | None = None,
    open_file_context: str | None = None,
    tutor_mode: str = DEFAULT_TUTOR_MODE,
    weak_topics: list[str] | None = None,
) -> Generator[bytes, None, None]:
    """Generator that yields SSE byte chunks. Pluggable into FastAPI's
    StreamingResponse with media_type='text/event-stream'.

    ``active_file_name`` + ``open_file_context`` carry the file the user is
    currently reading and a slice of its text. They are surfaced into the
    prompt so deictic questions like "what does this say?" or "explain this
    exercise" stay grounded in the section the user is actually looking at,
    even when retrieval doesn't pull the right chunk.
    """
    settings = get_settings()
    target_model = model or settings.openai_generate_model
    strength = _context_strength(chunks)
    used_chunks = chunks if strength == "strong" else []

    open_ctx = (open_file_context or "").strip()[:3500]
    has_open = bool(open_ctx)
    # Promote to "strong" when the user has a file open with visible text:
    # we don't want the WEAK prompt's "could not find enough material"
    # apology when they're literally reading the relevant page. The
    # currently-visible text becomes Source 0 of the context block.
    effective_strength = "strong" if (strength == "strong" or has_open) else strength
    tutor_mode_norm = normalise_tutor_mode(tutor_mode)
    system_prompt, answer_mode = pick_system_prompt(
        question, effective_strength, used_chunks, tutor_mode=tutor_mode_norm,
        weak_topics=weak_topics,
    )

    # Compose the context block. Open-file text goes first as [Source 0] so
    # the model cites it preferentially for deictic ("this question /
    # this section / the exercise above") queries. RAG-retrieved chunks
    # follow as [Source 1..N].
    parts: list[str] = []
    if has_open:
        open_name = active_file_name or "open file"
        parts.append(
            f"[Source 0] {open_name} — CURRENTLY VISIBLE IN PDF VIEWER\n{open_ctx}"
        )
    if used_chunks:
        parts.append(_build_context_block(used_chunks, doc_names))
    context_block = "\n\n---\n\n".join(parts)

    if active_file_name:
        system_prompt += (
            f"\n\nThe student is currently reading the file \"{active_file_name}\""
            " in the PDF viewer. When their question contains deictic references"
            " (\"this\", \"this question\", \"this section\", \"the exercise above\","
            " \"explain this\"), anchor your answer in [Source 0] (CURRENTLY VISIBLE)"
            " before consulting other sources."
        )

    user_message = "QUESTION:\n" + question.strip()
    if context_block:
        user_message += "\n\nCOURSE CONTEXT:\n\n" + context_block

    def _source_payload(c):
        return {
            "file_name": doc_names.get(c.document_id, "Unknown"),
            "pages": (
                str(c.page_start)
                if c.page_start and c.page_start == c.page_end
                else (f"{c.page_start}-{c.page_end}" if c.page_start and c.page_end else None)
            ),
            "section": c.section_title,
        }

    # Buffer the streamed answer so we can filter sources by the [Source N]
    # citations the model actually used. The full text isn't known until the
    # stream completes, so the filtering happens just before the 'done' event.
    answer_buf: list[str] = []

    # Send an opening "meta" event so the client can render the bubble
    # immediately, even before the first content token arrives.
    yield _sse({
        "meta": True,
        "retrievalMode": effective_strength,
        "answerMode": answer_mode,
        "tutorMode": tutor_mode_norm,
        "confidence": "high" if effective_strength == "strong" else "low",
        "unsupported": effective_strength != "strong",
    })

    client = OpenAI(api_key=settings.openai_api_key)
    prompt_tokens = None
    completion_tokens = None
    try:
        stream = client.chat.completions.create(
            model=target_model,
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_message},
            ],
        )
        for chunk in stream:
            # Usage chunk arrives at the end when include_usage=True.
            if getattr(chunk, "usage", None):
                if chunk.usage:
                    prompt_tokens = chunk.usage.prompt_tokens
                    completion_tokens = chunk.usage.completion_tokens
                continue
            choices = chunk.choices or []
            if not choices:
                continue
            delta = choices[0].delta
            token = getattr(delta, "content", None) if delta else None
            if token:
                answer_buf.append(token)
                yield _sse({"t": token})
    except Exception as e:  # noqa: BLE001
        log.exception("stream_answer failed")
        yield _sse({"error": f"{type(e).__name__}: {e}"})
        return

    full_answer = "".join(answer_buf)
    cited = _cited_indices(full_answer, len(used_chunks))
    filtered_sources = [_source_payload(c) for i, c in enumerate(used_chunks, start=1) if i in cited]

    # Phase 10 — deterministic verification on the streamed answer.
    # Include the open-file text in the haystack so formulas / numbers the
    # model lifted from [Source 0] aren't flagged as ungrounded.
    verification_haystack = [c.text for c in used_chunks]
    if has_open:
        verification_haystack.append(open_ctx)
    verification: dict[str, Any] = {"status": "missing_context", "reasons": [], "details": {}}
    try:
        from .verification import verify_answer  # noqa: WPS433
        verification = verify_answer(
            answer_text=full_answer,
            chunk_texts=verification_haystack,
            question=question,
            answer_mode=answer_mode,
        ).to_api()
    except Exception:  # noqa: BLE001
        log.exception("verify_answer (stream) failed — emitting default missing_context")

    yield _sse({
        "done": True,
        "retrievalMode": effective_strength,
        "answerMode": answer_mode,
        "tutorMode": tutor_mode_norm,
        "verification": verification,
        "confidence": "high" if effective_strength == "strong" else "low",
        "unsupported": effective_strength != "strong",
        "sources": filtered_sources,
        "model": target_model,
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
    })
