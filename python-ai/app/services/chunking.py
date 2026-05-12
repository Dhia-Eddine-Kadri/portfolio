"""Token-bounded chunker that's aware of pages, headings, and study-value sections.

Design notes
------------
- Targets `target_tokens` per chunk with `overlap_tokens` worth of prefix from the
  previous chunk, so retrieval rarely loses sentence context at boundaries.
- Tokeniser: tiktoken `cl100k_base` (same family used by text-embedding-3-small).
- Heading detection is conservative: short ALL-CAPS or numbered "1.2 Foo" lines.
  When we see one, the current chunk is forced to flush so a heading never
  ends up in the middle of a chunk.
- Chunk type guess is best-effort: matches German/English keywords for
  Aufgabe / Beispiel / Definition / Satz / Theorem / Formel / Lösung / etc.
- Returns a list of dicts ready to upsert into `document_chunks`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

import tiktoken

# Same encoding family OpenAI uses for text-embedding-3-small and GPT-4 family.
_ENC = tiktoken.get_encoding("cl100k_base")


def _count_tokens(text: str) -> int:
    return len(_ENC.encode(text))


# ── Heading / chunk-type detection ───────────────────────────────────────────

_NUMBERED_HEADING = re.compile(r"^\s*\d+(?:\.\d+){0,3}\s+\S+")          # "1.2 Force", "3 Methods"
_SHORT_CAPS_HEADING = re.compile(r"^[A-Z][A-Z0-9 \-–&,/]{2,60}$")        # "INTRODUCTION"
_TITLE_CASE_HEADING = re.compile(r"^[A-Z][\w][\w \-–&,/]{2,60}$")        # "Newton's Second Law"

# Keywords we use to tag chunk_type. Order matters — first match wins.
_TYPE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("definition",  re.compile(r"\b(definition|definiere|begriff)\b", re.I)),
    ("theorem",     re.compile(r"\b(theorem|satz|lemma|korollar|corollary)\b", re.I)),
    ("formula",     re.compile(r"\b(formel|formula|gleichung|equation)\b", re.I)),
    ("example",     re.compile(r"\b(beispiel|example|bsp\.)\b", re.I)),
    ("exercise",    re.compile(r"\b(aufgabe|übung|exercise|problem)\b", re.I)),
    ("solution",    re.compile(r"\b(lösung|lösungsweg|solution)\b", re.I)),
]


def _looks_like_heading(line: str) -> bool:
    line = line.strip()
    if len(line) < 3 or len(line) > 80:
        return False
    if line.endswith((".", ":", ",", ";")):  # sentences, not headings
        return False
    if _NUMBERED_HEADING.match(line):
        return True
    if _SHORT_CAPS_HEADING.match(line):
        return True
    # Title-case heuristic: short, no end-punctuation, mostly capitalised words.
    if _TITLE_CASE_HEADING.match(line):
        # Avoid grabbing every short sentence — require at least half the words capitalised.
        words = [w for w in line.split() if w]
        caps = sum(1 for w in words if w[:1].isupper())
        return len(words) <= 8 and caps / max(len(words), 1) >= 0.6
    return False


def _classify_chunk(text: str, heading: str | None) -> str:
    haystack = f"{heading or ''}\n{text}"
    for kind, pat in _TYPE_PATTERNS:
        if pat.search(haystack):
            return kind
    return "general"


# ── Chunker ──────────────────────────────────────────────────────────────────


@dataclass
class Chunk:
    chunk_text: str
    page_start: int
    page_end: int
    chunk_type: str
    section_title: str | None
    token_count: int


def chunk_pages(
    pages: list[str],
    target_tokens: int = 700,
    overlap_tokens: int = 80,
    min_chunk_tokens: int = 80,
) -> list[Chunk]:
    """Greedy paragraph-bounded chunker with overlap and heading awareness.

    The chunker walks every page's paragraphs and accumulates them into a
    running buffer. A chunk is emitted when (a) adding the next paragraph
    would exceed target_tokens, (b) the page boundary is reached and the
    buffer is large enough, or (c) a heading is seen. Each emitted chunk
    carries page_start / page_end and a best-effort chunk_type.
    """
    if not any(pages):
        return []

    chunks: list[Chunk] = []
    current_text_parts: list[str] = []
    current_tokens = 0
    current_page_start: int | None = None
    current_page_end: int | None = None
    current_heading: str | None = None

    def flush(reason: str) -> None:  # noqa: ARG001 — reason kept for debugging
        nonlocal current_text_parts, current_tokens, current_page_start, current_page_end
        text = "\n\n".join(p for p in current_text_parts if p).strip()
        if text and current_tokens >= min_chunk_tokens and current_page_start is not None:
            chunks.append(Chunk(
                chunk_text=text,
                page_start=current_page_start,
                page_end=current_page_end or current_page_start,
                chunk_type=_classify_chunk(text, current_heading),
                section_title=current_heading,
                token_count=current_tokens,
            ))
        current_text_parts = []
        current_tokens = 0
        current_page_start = None
        current_page_end = None

    for page_idx, page_text in enumerate(pages):
        page_number = page_idx + 1
        if not page_text.strip():
            continue

        for raw_para in _split_paragraphs(page_text):
            # Heading detection — never let a heading mid-chunk.
            if _looks_like_heading(raw_para):
                flush("heading")
                current_heading = raw_para.strip()
                # Headings don't accumulate as content; they only re-tag subsequent chunks.
                continue

            # A single paragraph might already blow the budget on its own
            # (one wall of text, no double-newlines). Split it on sentence
            # boundaries so we can still respect target_tokens.
            for segment in _bounded_segments(raw_para, target_tokens):
                seg_tokens = _count_tokens(segment)
                if seg_tokens == 0:
                    continue

                # If adding this segment blows the target, flush first.
                if current_tokens > 0 and current_tokens + seg_tokens > target_tokens:
                    # Carry an overlap tail forward for retrieval continuity.
                    tail = _overlap_tail(current_text_parts, overlap_tokens)
                    flush("size")
                    if tail:
                        current_text_parts = [tail]
                        current_tokens = _count_tokens(tail)
                        current_page_start = page_number
                        current_page_end = page_number

                current_text_parts.append(segment)
                current_tokens += seg_tokens
                if current_page_start is None:
                    current_page_start = page_number
                current_page_end = page_number

    flush("end")
    return chunks


# ── Helpers ──────────────────────────────────────────────────────────────────


def _split_paragraphs(page_text: str) -> Iterable[str]:
    """Split a page into paragraphs, dropping empties."""
    for block in page_text.split("\n\n"):
        block = block.strip()
        if block:
            yield block


# Sentence-boundary regex — keeps the punctuation with the sentence it ended.
_SENTENCE_END = re.compile(r"(?<=[\.\?\!])\s+(?=[A-Z0-9„\"\(\[])")


def _bounded_segments(paragraph: str, target_tokens: int) -> Iterable[str]:
    """Yield sub-paragraph segments that each fit roughly within target_tokens.

    For normal-sized paragraphs we just yield the original. For walls of
    text (no double-newlines) we split on sentence boundaries and pack
    sentences into segments until each segment approaches the budget.
    """
    if _count_tokens(paragraph) <= target_tokens:
        yield paragraph
        return

    sentences = [s.strip() for s in _SENTENCE_END.split(paragraph) if s.strip()]
    if not sentences:
        yield paragraph
        return

    buf: list[str] = []
    buf_tokens = 0
    for sent in sentences:
        s_tokens = _count_tokens(sent)
        if buf and buf_tokens + s_tokens > target_tokens:
            yield " ".join(buf)
            buf = []
            buf_tokens = 0
        buf.append(sent)
        buf_tokens += s_tokens
    if buf:
        yield " ".join(buf)


def _overlap_tail(parts: list[str], overlap_tokens: int) -> str:
    """Return the last `overlap_tokens` worth of text, walking parts back to front."""
    if not parts or overlap_tokens <= 0:
        return ""
    acc: list[str] = []
    total = 0
    for part in reversed(parts):
        toks = _count_tokens(part)
        if total + toks > overlap_tokens and acc:
            break
        acc.insert(0, part)
        total += toks
        if total >= overlap_tokens:
            break
    return "\n\n".join(acc).strip()
