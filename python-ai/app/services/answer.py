"""Grounded answer generation from retrieved chunks.

Hard rules from the architecture brief:
  - Use uploaded files as the only source of truth.
  - Never invent content; never silently fall back to general knowledge.
  - Cite source pages.
  - If retrieval is weak, say so explicitly with a marked "general explanation"
    rather than fabricating a confident answer.

Implementation:
  - We classify retrieval as STRONG / WEAK using simple thresholds on the
    top reranked chunks. Tunable; documented in the JSON response so it can
    be evaluated against the existing /api/ai/feedback flow.
  - Prompt is split into a system message (rules + identity) and a user
    message (question + numbered context chunks with page citations).
  - Returns a structured dict: answer text, retrieval mode, list of sources,
    plus model + token diagnostics for the eval pipeline.
"""

from __future__ import annotations

import logging
from typing import Any

from openai import OpenAI

from ..config import get_settings
from .retrieval import RetrievedChunk

log = logging.getLogger(__name__)


# Tunables. Mirrored from the existing JS pipeline so behaviour stays consistent
# during cutover; tighten/loosen later as we gather eval data.
_STRONG_SIMILARITY = 0.32   # at least one chunk above this → strong context
_STRONG_AVG_SCORE  = 0.30   # OR average reranked score across top chunks
_MIN_CONTEXT_CHARS = 400    # below this, we treat it as no useful context


_SYSTEM_PROMPT_STRONG = """You are Minallo's exam-prep tutor for a university student.
Answer the question STRICTLY using the COURSE CONTEXT below, which comes from the student's uploaded course files (lectures, exercises, summaries).

Rules:
1. Use ONLY the context. Do not invent facts. If a claim isn't supported by the context, do not make it.
2. Quote / paraphrase the relevant chunk and cite the source like "(filename, p.3)" using the [Source N] header.
3. If the context contradicts itself, acknowledge it and present both views.
4. Write math using KaTeX: $...$ for inline, $$...$$ for display.
5. Match the language of the question. If the question is in German, answer in German.
6. Be concise but thorough. Use bullet points for steps and definitions.

Open with a line like "Based on your uploaded files..." so the student knows the answer is grounded."""

_SYSTEM_PROMPT_WEAK = """You are Minallo's exam-prep tutor.
The student asked a question, but their uploaded files do NOT contain enough relevant material to ground a confident answer.

Behaviour:
1. Open with: "I could not find enough relevant information in your uploaded files to answer this confidently. Here is a general explanation, but it may not match your professor's approach:"
2. Provide a careful, textbook-style general explanation.
3. Do NOT fabricate citations.
4. Suggest what the student could upload (lecture slides, the exercise sheet, the formula sheet) to get a properly grounded answer next time.
5. Write math using KaTeX: $...$ inline, $$...$$ display.
6. Match the language of the question."""


def _context_strength(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "none"
    top_sim = max((c.similarity for c in chunks), default=0.0)
    avg_score = sum(c.score for c in chunks[:5]) / max(min(len(chunks), 5), 1)
    total_chars = sum(len(c.text) for c in chunks)
    if total_chars < _MIN_CONTEXT_CHARS:
        return "weak"
    if top_sim >= _STRONG_SIMILARITY or avg_score >= _STRONG_AVG_SCORE:
        return "strong"
    return "weak"


def _build_context_block(chunks: list[RetrievedChunk], doc_names: dict[str, str]) -> str:
    parts: list[str] = []
    for i, c in enumerate(chunks, start=1):
        file_name = doc_names.get(c.document_id, "Unknown")
        if c.page_start and c.page_end:
            pages = f"p.{c.page_start}" if c.page_start == c.page_end else f"pp.{c.page_start}-{c.page_end}"
        else:
            pages = "no-page"
        header = f"[Source {i}] {file_name}, {pages}"
        if c.section_title:
            header += f"\nSection: {c.section_title}"
        parts.append(f"{header}\n{c.text}")
    return "\n\n---\n\n".join(parts)


def generate_answer(
    *,
    question: str,
    chunks: list[RetrievedChunk],
    doc_names: dict[str, str],
    model: str | None = None,
    max_tokens: int = 1200,
) -> dict[str, Any]:
    """Return the structured answer dict the API surface exposes."""
    settings = get_settings()
    target_model = model or settings.openai_generate_model

    strength = _context_strength(chunks)
    used_chunks = chunks if strength == "strong" else []
    system_prompt = _SYSTEM_PROMPT_STRONG if strength == "strong" else _SYSTEM_PROMPT_WEAK
    context_block = _build_context_block(used_chunks, doc_names) if used_chunks else ""

    user_message = "QUESTION:\n" + question.strip()
    if context_block:
        user_message += "\n\nCOURSE CONTEXT:\n\n" + context_block

    client = OpenAI(api_key=settings.openai_api_key)
    completion = client.chat.completions.create(
        model=target_model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_message},
        ],
    )
    msg = completion.choices[0].message if completion.choices else None
    answer_text = (msg.content if msg else "") or ""

    sources = [
        {
            "fileName":  doc_names.get(c.document_id, "Unknown"),
            "pageStart": c.page_start,
            "pageEnd":   c.page_end,
            "sectionTitle": c.section_title,
            "chunkType": c.chunk_type,
            "similarity": round(c.similarity, 4),
        }
        for c in used_chunks
    ]

    return {
        "answer":          answer_text,
        "retrievalMode":   strength,                # strong | weak | none
        "groundedSources": sources,
        "model":           target_model,
        "promptTokens":    completion.usage.prompt_tokens if completion.usage else None,
        "completionTokens": completion.usage.completion_tokens if completion.usage else None,
    }
