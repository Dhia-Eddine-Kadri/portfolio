"""Cheatsheet generation — Learning Agent Phase 4.

A cheatsheet is NOT a long study guide (that's notes.py). It is a dense,
exam-ready reference: the highest-value formulas, definitions and rules a
student wants on one page during revision. Two things make it a Learning
Agent feature rather than a second notes generator:

  * **Topic-Map driven.** Coverage and ordering come from the course Topic Map
    (``learning_agent.get_course_topic_map``) — high-importance topics first,
    so the densest page is spent on what matters most. An explicit ``topic``
    focuses the sheet on one area instead.
  * **Grounded retrieval.** Evidence is pooled per topic through
    ``retrieve_learning_context(purpose="cheatsheet")`` (broad fan-out), so
    every line traces back to the user's own chunks. No outside knowledge.

Output is markdown, stored via ``notes.save_note(note_type="cheatsheet")`` so
it reuses the notes table, RLS, CRUD endpoint and notes list — a cheatsheet is
just another generated document.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any

from .learning_agent import get_course_topic_map, retrieve_learning_context
from .llm_json import chat_json
from .notes import save_note
from .cheatsheet_quality import (
    formula_corruption_reasons,
    formula_to_latexish,
    normalize_evidence_chunks,
    normalize_formula_text,
    repair_mojibake,
)
from ..supabase_client import get_supabase

log = logging.getLogger(__name__)

# A cheatsheet is dense but bounded. Generation runs ~40 tok/s on this account,
# so OUTPUT length is the main driver of latency — but INPUT evidence is nearly
# free by comparison. The Stage 0 diagnostic (scripts/diagnose_cheatsheet_source)
# showed that on a well-indexed course retrieval returns ~6 clean formula-bearing
# chunks per topic across 124 topics, yet the old caps (10 topics × top_k 3,
# 20 evidence) starved the model: it never SAW most of the formulas it was
# accused of "missing". The fix is to widen the evidence pool the model chooses
# from — not to make it write more — so the same bounded output is spent on the
# best real formulas. Output stays capped for the edge proxy's upstream timeout.
# Evidence (INPUT) is widened hard — that's the Stage 0 fix. Topic/section count
# (which drives OUTPUT length, hence wall-clock against the 45s proxy timeout) is
# raised only modestly so a full sheet still finishes in budget.
_MAX_TOPICS = 14            # importance-ranked sections (was 10)
_PER_TOPIC_TOP_K = 5        # retrieval supplies ~6 formula chunks/topic (was 3)
_MAX_EVIDENCE = 36          # richer pool for the model to SELECT from (was 20)

# Per-PDF mode: when the user picks a small set of PDFs we produce one section
# per PDF and dedup across them. Above this count it's effectively "whole course"
# and per-PDF sectioning can't fit the output budget, so we fall back to the
# topic-map sheet. (1 doc needs no sectioning — it's already a single-PDF sheet.)
_MAX_PER_PDF_DOCS = 5

_MECHANICS_TOPIC_ORDER = (
    "Kinematik eines Punktes",
    "Kartesische Koordinaten",
    "Geradlinige Bewegung",
    "Wurfbewegung",
    "Polarkoordinaten",
    "Tangential- und Normalkoordinaten",
    "Dynamik von Punktmassen",
    "Bewegungsgleichungen",
    "Reibung und Widerstand",
    "Arbeit, Energie und Leistung",
    "Impuls und Sto\u00df",
    "Dynamik von Punktsystemen",
    "Schwerpunkt / Massenmittelpunkt",
    "Rotation starrer K\u00f6rper",
    "Tr\u00e4gheitsmoment",
    "Drehimpuls",
    "Ebene Bewegung starrer K\u00f6rper",
    "Rollbewegung",
    "Variable Masse / Raketenbewegung",
    "Pendel",
)

_MECHANICS_TOPIC_ALIASES: tuple[tuple[str, str], ...] = (
    ("systems of point masses", "Dynamik von Punktsystemen"),
    ("dynamics of systems of point masses", "Dynamik von Punktsystemen"),
    ("korpersystem", "Dynamik von Punktsystemen"),
    ("koerpersystem", "Dynamik von Punktsystemen"),
    ("punktsystem", "Dynamik von Punktsystemen"),
    ("massensystem", "Dynamik von Punktsystemen"),
    ("schwerpunkt", "Schwerpunkt / Massenmittelpunkt"),
    ("massenmittelpunkt", "Schwerpunkt / Massenmittelpunkt"),
    ("center of mass", "Schwerpunkt / Massenmittelpunkt"),
    ("centre of mass", "Schwerpunkt / Massenmittelpunkt"),
    ("kinematik", "Kinematik eines Punktes"),
    ("kinematics", "Kinematik eines Punktes"),
    ("kartesisch", "Kartesische Koordinaten"),
    ("cartesian", "Kartesische Koordinaten"),
    ("geradlinig", "Geradlinige Bewegung"),
    ("rectilinear", "Geradlinige Bewegung"),
    ("wurf", "Wurfbewegung"),
    ("projectile", "Wurfbewegung"),
    ("polar", "Polarkoordinaten"),
    ("tangential", "Tangential- und Normalkoordinaten"),
    ("normal", "Tangential- und Normalkoordinaten"),
    ("punktmasse", "Dynamik von Punktmassen"),
    ("point mass", "Dynamik von Punktmassen"),
    ("bewegungsgleich", "Bewegungsgleichungen"),
    ("equations of motion", "Bewegungsgleichungen"),
    ("reibung", "Reibung und Widerstand"),
    ("friction", "Reibung und Widerstand"),
    ("widerstand", "Reibung und Widerstand"),
    ("drag", "Reibung und Widerstand"),
    ("arbeit", "Arbeit, Energie und Leistung"),
    ("energie", "Arbeit, Energie und Leistung"),
    ("leistung", "Arbeit, Energie und Leistung"),
    ("work", "Arbeit, Energie und Leistung"),
    ("energy", "Arbeit, Energie und Leistung"),
    ("power", "Arbeit, Energie und Leistung"),
    ("impuls", "Impuls und Sto\u00df"),
    ("stoss", "Impuls und Sto\u00df"),
    ("sto\u00df", "Impuls und Sto\u00df"),
    ("momentum", "Impuls und Sto\u00df"),
    ("impact", "Impuls und Sto\u00df"),
    ("rotation", "Rotation starrer K\u00f6rper"),
    ("starrer korper", "Rotation starrer K\u00f6rper"),
    ("rigid bod", "Rotation starrer K\u00f6rper"),
    ("tragheitsmoment", "Tr\u00e4gheitsmoment"),
    ("traegheitsmoment", "Tr\u00e4gheitsmoment"),
    ("moment of inertia", "Tr\u00e4gheitsmoment"),
    ("drehimpuls", "Drehimpuls"),
    ("angular momentum", "Drehimpuls"),
    ("ebene bewegung", "Ebene Bewegung starrer K\u00f6rper"),
    ("plane motion", "Ebene Bewegung starrer K\u00f6rper"),
    ("rollen", "Rollbewegung"),
    ("rollbewegung", "Rollbewegung"),
    ("rolling", "Rollbewegung"),
    ("variable masse", "Variable Masse / Raketenbewegung"),
    ("rakete", "Variable Masse / Raketenbewegung"),
    ("rocket", "Variable Masse / Raketenbewegung"),
    ("pendel", "Pendel"),
    ("pendulum", "Pendel"),
)

_MECHANICS_TRAP_BANK: dict[str, tuple[str, ...]] = {
    "Kinematik eines Punktes": (
        "Constant-a formulas are only valid if a = const.",
        "For a(t), integrate first and then apply initial conditions.",
    ),
    "Geradlinige Bewegung": (
        "Constant-a formulas are only valid if a = const.",
        "Initial conditions fix the integration constants; do not skip them.",
    ),
    "Polarkoordinaten": (
        "v is generally not tangential to the trajectory unless r_dot = 0.",
        "The term 2 r_dot phi_dot appears because the basis vectors change with time.",
    ),
    "Tangential- und Normalkoordinaten": (
        "a_t changes speed; a_n changes direction.",
        "Use the tangential equation for speed changes and the normal equation for direction changes.",
    ),
    "Reibung und Widerstand": (
        "Static friction is not automatically mu_0 N; only |H| <= mu_0 N.",
        "Friction direction opposes relative motion or tendency of motion.",
    ),
    "Arbeit, Energie und Leistung": (
        "Constraint forces do no work if perpendicular to displacement.",
        "Friction and drag are dissipative and have no potential energy.",
        "Friction work is negative.",
    ),
    "Dynamik von Punktsystemen": (
        "Internal forces cancel in system momentum balances.",
        "Only external forces determine center-of-mass acceleration.",
    ),
    "Schwerpunkt / Massenmittelpunkt": (
        "Use external forces for a_S; internal forces cancel in the system balance.",
    ),
    "Rollbewegung": (
        "Rolling constraint x_dot_S = r omega is valid only without slipping.",
        "If sliding occurs, the rolling constraint is invalid.",
    ),
}

_GENERIC_FILLER_RE = re.compile(
    r"^\s*(?:[-*]\s*)?(?:"
    r"(?:be\s+)?careful\s+with\s+directions?|"
    r"direction\s+(?:matters|of\s+forces\s+affects\s+acceleration)|"
    r"consider\s+all\s+forces|"
    r"pay\s+attention\s+to\s+signs?|"
    r"check\s+(?:your\s+)?units?|"
    r"achte\s+auf\s+(?:richtungen|vorzeichen|einheiten)|"
    r"richtung(?:en)?\s+(?:beachten|ist\s+wichtig)"
    r")\.?\s*$",
    re.I,
)

_SYSTEM = (
    "You are ExamForge by Minallo, writing a DENSE, exam-ready CHEATSHEET from a "
    "student's own course materials — a compressed, multi-column academic "
    "reference sheet (Hyperknow style), NOT a study guide or an AI summary.\n"
    "\n"
    "Use ONLY the provided COURSE CONTEXT. Do not use outside knowledge.\n"
    "\n"
    "STRUCTURE — organise by the topics given, in order (most important first), "
    "one `##` section per topic. Each section is a tight block:\n"
    "- Lead with a ONE-LINE definition / core idea.\n"
    "- Then the key FORMULAS (KaTeX: $...$ inline, $$...$$ display; name each "
    "symbol once; state assumptions/conditions).\n"
    "- Then SPECIAL CASES as a numbered list (e.g. `1. Uniform motion (a=0)`), "
    "each with its formula and the condition it needs.\n"
    "- Then terse notes / pitfalls. Bullets with a bold lead-in: "
    "`- **Term:** meaning`. One line each. No prose paragraphs, no intros.\n"
    "\n"
    "PRECISION (be slightly MORE precise than a generic cheatsheet):\n"
    "- Only formulas SUPPORTED BY THE CONTEXT. Never invent or guess a formula.\n"
    "- Distinguish general formulas from special cases; keep notation consistent; "
    "define a symbol the first time it is ambiguous; include key edge conditions.\n"
    "- If the context has nothing for a planned topic, OMIT it — never pad.\n"
    "- The COURSE CONTEXT is a broad pool: mine it for EVERY distinct, "
    "high-value formula/rule it actually supports — coverage of real formulas "
    "is the goal. Keep each one tight (one line); drop duplicates and trivia "
    "rather than spending space on prose.\n"
    "- Match the language of the source material.\n"
    "\n"
    "DENSITY — this is a compact REFERENCE sheet, not a summary. Cover the "
    "HIGHEST-VALUE formulas the evidence supports, each as a display formula "
    "($$...$$). Be RUTHLESSLY TERSE: at most a few words of context per formula, "
    "no prose paragraphs, no filler. Prefer fewer well-chosen formulas over a "
    "long sheet. Drop duplicates and anything not grounded; never invent.\n"
    "\n"
    "EMPHASIS MARKERS (use exactly these; never inside a formula):\n"
    "- Wrap THE single most important fact/result of a block in ==double "
    "equals== (renders as a yellow highlight). At most one per block.\n"
    "- Begin a hard warning with `Important:` or `Critical:` (renders red).\n"
    "- Begin a soft remark with `Note:` (renders orange).\n"
    "- Wrap a key concept term in {{double braces}} (renders blue). Use "
    "sparingly — only genuinely central terms.\n"
    "\n"
    "SOURCES — keep them subtle: do NOT cite every line. Add a small "
    "`(filename, p.N)` only where a specific formula needs provenance, and end "
    "with one short `## Sources` list. Never spam citations.\n"
    "\n"
    'Return ONLY JSON: {"text":"<markdown cheatsheet>"}'
)


# ── Settings (Stage 3) ───────────────────────────────────────────────────────
#
# Four presets cover ~90% of the value; only two free overrides (pages, language)
# are exposed — deliberately NOT an 8-dimension à-la-carte matrix, which would be
# untestable and need a conflict-warning babysitter. Each preset resolves to a
# concrete generation budget (how many topics/sections, how hard to push density)
# and a layout hint (columns/font) echoed back so the renderer matches.

_PRESETS: dict[str, dict[str, Any]] = {
    # name            topics  density   columns  font
    "exam_night":     {"topics": 9,  "density": "max",     "columns": 4, "font": "xs"},
    "balanced":       {"topics": 10, "density": "high",    "columns": 3, "font": "sm"},
    "deep_revision":  {"topics": 12, "density": "high",    "columns": 3, "font": "md"},
    "topic_mastery":  {"topics": 5,  "density": "thorough","columns": 2, "font": "md"},
}
_DEFAULT_PRESET = "balanced"
_VALID_PAGES = (1, 2, 3, 4)
_VALID_LANGS = ("source", "en", "de")
# Density label → the count band we ask the model to aim for. HARD CONSTRAINT:
# output runs ~40 tok/s against the upstream timeout, AND the sheet is one JSON
# string (a run that overshoots the token cap truncates → "could not parse model
# JSON"). Model verbosity varies run-to-run, so we keep the TARGET modest enough
# that even a verbose run finishes well under both the cap and ~45s of wall time.
# Bigger bands gave ~30 formulas but intermittently timed out / truncated.
_DENSITY_TARGET = {
    "max": "16-24", "high": "14-20", "thorough": "10-16",
}
# Hard time bound: output runs ~40 tok/s, so 1400 tokens ≈ 35s + overhead < 45s,
# fitting even the OLD proxy timeout (so the feature works regardless of whether
# the 60s proxy bump is deployed). A verbose run that hits this cap is salvaged
# (chat_json salvage_key) into a slightly-shorter but renderable sheet instead of
# a JSON parse failure.
_MAX_TOKENS = 1400
_LANG_INSTRUCTION = {
    "source": "Match the language of the source material.",
    "en": "Write the cheatsheet in English regardless of the source language.",
    "de": "Write the cheatsheet in German (Deutsch) regardless of the source language.",
}


def normalize_settings(settings: dict[str, Any] | None) -> dict[str, Any]:
    """Resolve a (possibly partial/garbage) settings dict into a concrete,
    clamped config. Always returns a full dict so callers never branch on None."""
    s = settings or {}
    preset = str(s.get("preset") or _DEFAULT_PRESET).lower()
    if preset not in _PRESETS:
        preset = _DEFAULT_PRESET
    base = dict(_PRESETS[preset])

    pages = s.get("pages")
    pages = pages if pages in _VALID_PAGES else (1 if preset == "exam_night" else 2)
    # More pages → a few more sections; fewer → tighter. A gentle ±delta (NOT a
    # multiplier — that re-inflated topics to 18-20 and blew the 45s timeout).
    # Capped at 14 so even "4 pages" stays inside the output budget.
    base["topics"] = max(4, min(14, base["topics"] + (pages - 2) * 2))

    lang = str(s.get("language") or "source").lower()
    if lang not in _VALID_LANGS:
        lang = "source"

    return {
        "preset": preset,
        "pages": pages,
        "language": lang,
        "columns": base["columns"],
        "font": base["font"],
        "densityTarget": _DENSITY_TARGET.get(base["density"], "30-50"),
        "maxTopics": base["topics"],
        "langInstruction": _LANG_INSTRUCTION.get(lang, _LANG_INSTRUCTION["source"]),
    }


# ── Sanitization (Stage 4) ───────────────────────────────────────────────────
#
# OCR'd source material leaks two kinds of garbage into generated sheets, both
# observed in real output:
#   * the Unicode replacement char � (�) where OCR couldn't decode a glyph
#     (e.g. "Körpersystemen" → "K�rpersystemen"), and stray control chars;
#   * malformed display formulas — unbalanced braces, empty bodies, or "$$ (20)
#     $$" (an equation NUMBER mis-captured as a formula).
# A broken formula on a cheatsheet is worse than a missing one (it looks
# authoritative and is wrong), so we drop what we can't trivially trust. This is
# strictly mechanical — no LLM, no guessing the intended content.

_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_DISPLAY_FORMULA_RE = re.compile(r"\$\$(.+?)\$\$", re.S)
_INLINE_FORMULA_RE = re.compile(r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)", re.S)
# A real formula body has at least one relational/operator/structure token.
_HAS_MATH_RE = re.compile(r"[=<>+\-*/^_]|\\frac|\\int|\\sum|\\sqrt|\\partial|\\cdot|\\times|\\le|\\ge")


def _formula_body_ok(body: str) -> bool:
    """True if a display-formula body is safe to render: balanced braces, no
    replacement char, non-empty, and actually contains math (not just "(20)")."""
    b = formula_to_latexish(body).strip()
    if formula_corruption_reasons(b):
        return False
    if not b or "�" in b:
        return False
    if b.count("{") != b.count("}"):
        return False
    return bool(_HAS_MATH_RE.search(b))


def sanitize_cheatsheet_markdown(text: str) -> tuple[str, int]:
    """Mechanically clean a generated cheatsheet. Returns (cleaned, dropped),
    where ``dropped`` is the number of malformed display formulas removed.

    - Strips the replacement char � and control chars everywhere.
    - Drops any ``$$...$$`` block whose body isn't safe to render, replacing it
      with a subtle, honest marker rather than broken LaTeX.
    """
    if not text:
        return "", 0
    text = repair_mojibake(text)
    # 1) corruption chars (also fixes � inside inline $...$ and headings)
    cleaned = text.replace("�", "").replace("\r", "")
    cleaned = _CTRL_RE.sub("", cleaned)

    # 1b) a salvaged (token-cap-truncated) sheet can end mid-formula, leaving a
    # dangling unterminated "$$" that would break KaTeX. If the display-delimiter
    # count is odd, drop everything from the last "$$" onward.
    if cleaned.count("$$") % 2 == 1:
        cleaned = cleaned[: cleaned.rfind("$$")].rstrip()

    # 2) malformed display formulas
    dropped = 0

    def _display_repl(m: "re.Match[str]") -> str:
        nonlocal dropped
        normalized = normalize_formula_text(m.group(1))
        if normalized and _formula_body_ok(normalized):
            return "$$" + normalized + "$$"
        dropped += 1
        return "*(formula omitted — unreadable in source)*"

    def _inline_repl(m: "re.Match[str]") -> str:
        nonlocal dropped
        normalized = normalize_formula_text(m.group(1))
        if normalized:
            return "$" + normalized + "$"
        dropped += 1
        return "*(formula omitted - unreadable in source)*"

    cleaned = _DISPLAY_FORMULA_RE.sub(_display_repl, cleaned)
    cleaned = _INLINE_FORMULA_RE.sub(_inline_repl, cleaned)
    return cleaned, dropped


def _normalize_formula_key(body: str) -> str:
    """Whitespace/spacing-insensitive key for duplicate detection."""
    k = body.lower()
    k = re.sub(r"\\[,;:!\s]", "", k)   # latex thin spaces / escaped spaces
    k = re.sub(r"\s+", "", k)
    return k.strip("$ ")


def dedup_display_formulas(text: str) -> tuple[str, int]:
    """Remove EXACT repeated display formulas, keeping the first occurrence.

    The per-PDF prompt asks the model to dedup across PDF sections, but models
    are unreliable at it; this is the deterministic backstop that GUARANTEES no
    display formula appears twice. Duplicates are replaced with a subtle marker
    so the section still reads naturally; resulting empty bullets are trimmed.
    """
    seen: set[str] = set()
    removed = 0

    def _repl(m: "re.Match[str]") -> str:
        nonlocal removed
        key = _normalize_formula_key(m.group(1))
        if not key:
            return m.group(0)
        if key in seen:
            removed += 1
            return "*(see above)*"
        seen.add(key)
        return m.group(0)

    out = _DISPLAY_FORMULA_RE.sub(_repl, text)
    # Trim bullets/lines left empty or holding only the marker.
    out = re.sub(r"(?m)^\s*[-*]\s*(\*\(see above\)\*)?\s*$", "", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out, removed


# ── Grounding (Stage 2) ──────────────────────────────────────────────────────
#
# We can cheaply check that a formula's distinctive tokens actually appear in the
# retrieved source text — a mechanical hallucination signal, NOT proof the
# formula is on the exact cited page (the LLM still chooses the page, and LLMs
# attribute sloppily). So this only LABELS honestly and WARNS; it never drops a
# formula, because OCR noise can make a correct formula fail to match garbled
# source text — dropping it would be worse than flagging.

# LaTeX command words to ignore when extracting a formula's "real" tokens.
_LATEX_WORDS = frozenset({
    "frac", "cdot", "times", "sqrt", "int", "sum", "partial", "left", "right",
    "begin", "end", "text", "mathrm", "mathbf", "vec", "hat", "bar", "dot",
    "ddot", "infty", "alpha", "beta", "gamma", "delta", "theta", "lambda",
    "omega", "pi", "mu", "rho", "sigma", "tau", "phi", "psi", "nabla",
})
_FORMULA_TOK_RE = re.compile(r"[a-z0-9]{2,}")


def _formula_grounded(body: str, corpus: str) -> bool:
    """True if a formula body's distinctive multi-char tokens appear in the
    evidence corpus. Single-symbol formulas (no multi-char token) can't be
    disproved mechanically, so they're treated as grounded (no false alarm)."""
    toks = {t for t in _FORMULA_TOK_RE.findall(body.lower()) if t not in _LATEX_WORDS}
    if not toks:
        return True
    hits = sum(1 for t in toks if t in corpus)
    return hits >= max(1, len(toks) // 2)


def formula_grounding(text: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    """Mechanical grounding metric over the sheet's display formulas. Returns
    {total, grounded, ratio}. ratio is None when there are no display formulas."""
    bodies = _DISPLAY_FORMULA_RE.findall(text or "")
    total = len(bodies)
    if not total:
        return {"total": 0, "grounded": 0, "ratio": None}
    corpus = " ".join((c.get("text") or "") for c in evidence).lower()
    grounded = sum(1 for b in bodies if _formula_grounded(b, corpus))
    return {"total": total, "grounded": grounded, "ratio": round(grounded / total, 3)}


def drop_unsupported_display_formulas(
    text: str,
    evidence: list[dict[str, Any]],
) -> tuple[str, int]:
    """Remove display formulas that cannot be matched to retrieved source text.

    This is a deterministic source-support gate, not a proof of mathematical
    equivalence. It only acts on display formulas; inline symbols like `$v$`
    remain usable labels/variables in prose.
    """
    corpus = " ".join((c.get("text") or "") for c in evidence).lower()
    removed = 0

    def _repl(m: "re.Match[str]") -> str:
        nonlocal removed
        body = m.group(1)
        if _formula_grounded(body, corpus):
            return m.group(0)
        removed += 1
        return "*(formula omitted - not supported by retrieved source text)*"

    return _DISPLAY_FORMULA_RE.sub(_repl, text or ""), removed


def remove_generic_filler_notes(text: str) -> tuple[str, int]:
    """Remove vague warning lines that add no exam value."""
    removed = 0
    kept: list[str] = []
    for line in (text or "").splitlines():
        if _GENERIC_FILLER_RE.match(line.strip()):
            removed += 1
            continue
        kept.append(line)
    out = "\n".join(kept)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out, removed


def _topic_key(text: str) -> str:
    repaired = repair_mojibake(text or "").lower()
    stripped = "".join(
        ch for ch in unicodedata.normalize("NFKD", repaired)
        if not unicodedata.combining(ch)
    )
    return re.sub(r"[^a-z0-9]+", " ", stripped).strip()


def _canonical_mechanics_topic(name: str) -> str:
    key = _topic_key(name)
    if not key:
        return name
    for needle, canonical in _MECHANICS_TOPIC_ALIASES:
        if needle in key:
            return canonical
    return repair_mojibake(name).strip()


def _dedupe_topic_names(names: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for name in names:
        canonical = _canonical_mechanics_topic(name)
        key = _topic_key(canonical)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(canonical)
    mechanics_rank = {name: i for i, name in enumerate(_MECHANICS_TOPIC_ORDER)}
    indexed = list(enumerate(out))
    indexed.sort(key=lambda item: (mechanics_rank.get(item[1], len(mechanics_rank)), item[0]))
    return [name for _, name in indexed]


def _topic_names(
    topic_map: list[dict[str, Any]],
    topic_focus: str | None,
    limit: int = _MAX_TOPICS,
) -> list[str | None]:
    if topic_focus:
        return [_canonical_mechanics_topic(topic_focus)]
    names = [t.get("name") for t in (topic_map or []) if t.get("name")]
    names = _dedupe_topic_names([str(n) for n in names])
    return names[:limit] or [None]


def _topic_query(topic: str | None) -> str:
    if not topic:
        return "key formulas, definitions, rules, theorems"
    aliases = [needle for needle, canonical in _MECHANICS_TOPIC_ALIASES if canonical == topic]
    if aliases:
        return topic + " " + " ".join(aliases[:8])
    return topic


def _trap_guidance(topics: list[str | None]) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for topic in topics:
        if not topic:
            continue
        canonical = _canonical_mechanics_topic(topic)
        for trap in _MECHANICS_TRAP_BANK.get(canonical, ()):
            if trap in seen:
                continue
            seen.add(trap)
            lines.append(f"- {canonical}: {trap}")
    if not lines:
        return ""
    return (
        "\n\nCURATED EXAM TRAPS (include only relevant, precise traps; do not "
        "invent vague warnings):\n" + "\n".join(lines)
    )




def _pool_evidence(
    *,
    user_id: str,
    course_id: str,
    topics: list[str | None],
    document_ids: list[str] | None,
) -> list[dict[str, Any]]:
    """Retrieve a deduped, source-grounded evidence pool across the topics."""
    seen: set[str] = set()
    pooled: list[dict[str, Any]] = []
    for t in topics:
        try:
            chunks = retrieve_learning_context(
                user_id=user_id,
                course_id=course_id,
                topic=t,
                query=_topic_query(t),
                document_ids=document_ids or None,
                purpose="cheatsheet",
                top_k=_PER_TOPIC_TOP_K,
            )
        except Exception:  # noqa: BLE001
            log.exception("cheatsheet evidence retrieval failed (topic=%s)", t)
            chunks = []
        for c in chunks:
            cid = c.get("chunkId")
            if cid and cid not in seen:
                seen.add(cid)
                pooled.append(c)
    return pooled[:_MAX_EVIDENCE]


def _backfill_doc_names(chunks: list[dict[str, Any]], doc_names: dict[str, str]) -> dict[str, str]:
    """Fill in filenames for any documentIds in ``chunks`` not already known.

    ``retrieve_learning_context`` returns ``to_api`` dicts, which carry no
    filename — so course-wide cheatsheets (no caller-supplied ``doc_names``)
    would otherwise cite "Unknown". Mirrors notes.backfill_doc_names but for
    dict chunks. Best-effort: lookup failures just leave "Unknown".
    """
    missing = {c.get("documentId") for c in chunks if c.get("documentId")} - set(doc_names)
    missing.discard(None)
    if not missing:
        return doc_names
    try:
        resp = (
            get_supabase().table("documents")
            .select("id, file_name")
            .in_("id", list(missing))
            .execute()
        )
        for row in (resp.data or []):
            if row.get("id") and row.get("file_name"):
                doc_names[row["id"]] = row["file_name"]
    except Exception:  # noqa: BLE001
        log.exception("cheatsheet doc-name backfill failed (non-fatal)")
    return doc_names


def _format_evidence(
    chunks: list[dict[str, Any]], doc_names: dict[str, str], topics: list[str | None]
) -> str:
    """Group evidence by planned topic so the model can write one section each.

    Each chunk is tagged with its filename + page for inline citation.
    """
    parts: list[str] = []
    topic_line = ", ".join(t for t in topics if t) or "the course"
    parts.append("TOPICS TO COVER (in this order): " + topic_line + "\n")
    for i, c in enumerate(chunks, 1):
        fn = doc_names.get(c.get("documentId") or "", "source")
        pg = c.get("pageStart")
        text = (c.get("text") or "").strip().replace("\r", " ")
        if len(text) > 700:
            text = text[:700] + " …"
        head = f"[Source {i}] {fn}" + (f", p.{pg}" if pg else "")
        parts.append(f"{head}\n{text}")
    return "\n\n---\n\n".join(parts)


def _pool_evidence_by_doc(
    *,
    user_id: str,
    course_id: str,
    document_ids: list[str],
    topics: list[str | None],
    per_doc_cap: int,
) -> "dict[str, list[dict[str, Any]]]":
    """Retrieve topic-ranked evidence separately for each selected PDF.

    The topic map runs in the background here: we query each doc with the
    course's key-topic terms so the strongest formulas surface, but the result
    is grouped by document so the model can write one section per PDF.
    """
    topic_terms = " ".join(_topic_query(t) for t in topics if t) or ""
    query = (topic_terms + " key formulas, definitions, rules, theorems").strip()
    by_doc: dict[str, list[dict[str, Any]]] = {}
    for doc_id in document_ids:
        try:
            chunks = retrieve_learning_context(
                user_id=user_id,
                course_id=course_id,
                topic=None,
                query=query,
                document_ids=[doc_id],
                purpose="cheatsheet",
                top_k=per_doc_cap,
            )
        except Exception:  # noqa: BLE001
            log.exception("cheatsheet per-doc retrieval failed (doc=%s)", doc_id)
            chunks = []
        if chunks:
            by_doc[doc_id] = chunks
    return by_doc


def _format_evidence_by_doc(
    by_doc: "dict[str, list[dict[str, Any]]]", doc_names: dict[str, str]
) -> str:
    """Group evidence under one block per PDF so the model writes a section each."""
    blocks: list[str] = []
    n = 0
    for doc_id, chunks in by_doc.items():
        fn = doc_names.get(doc_id, "source")
        lines = [f"### SOURCE PDF: {fn}"]
        for c in chunks:
            n += 1
            pg = c.get("pageStart")
            text = (c.get("text") or "").strip().replace("\r", " ")
            if len(text) > 700:
                text = text[:700] + " …"
            head = f"[Source {n}] {fn}" + (f", p.{pg}" if pg else "")
            lines.append(f"{head}\n{text}")
        blocks.append("\n\n".join(lines))
    return "\n\n=====\n\n".join(blocks)


def _settings_system_prompt(cfg: dict[str, Any], *, per_pdf: bool = False) -> str:
    """Append the settings-specific overrides to the base system prompt. These
    come LAST so they take precedence over the generic guidance in _SYSTEM."""
    prompt = (
        _SYSTEM
        + "\n\nSETTINGS (override any generic guidance above):\n"
        + f"- Aim for {cfg['densityTarget']} formulas across the sheet when the "
        "evidence supports them; never invent to hit the number.\n"
        + f"- {cfg['langInstruction']}"
    )
    if per_pdf:
        prompt += (
            "\n\nSTRUCTURE OVERRIDE — PER-PDF MODE (ignore the topic-organisation "
            "rule above):\n"
            "- The COURSE CONTEXT is grouped under '### SOURCE PDF: <filename>' "
            "blocks. Produce ONE `##` section per SOURCE PDF, in the same order, "
            "using that PDF's filename as the `##` heading.\n"
            "- Under each heading put only the highest-value formulas/rules that "
            "come FROM THAT PDF.\n"
            "- DEDUP (critical): each distinct formula/rule appears EXACTLY ONCE, "
            "under the FIRST PDF that contains it. If it already appeared in an "
            "earlier PDF's section, OMIT it from later sections — do not repeat it.\n"
            "- If, after removing repeats, a PDF has nothing unique left, give it "
            "a one-line '(no unique formulas — covered above)' note instead of a "
            "section body."
        )
    return prompt


def generate_cheatsheet(
    *,
    user_id: str,
    course_id: str,
    document_ids: list[str] | None,
    topic: str | None,
    doc_names: dict[str, str],
    save: bool = True,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate (and optionally save) a grounded, Topic-Map-driven cheatsheet."""
    cfg = normalize_settings(settings)
    topic_query = (topic or "").strip() or None
    try:
        topic_map = get_course_topic_map(user_id, course_id)
    except Exception:  # noqa: BLE001
        log.exception("cheatsheet: topic map read failed")
        topic_map = []
    topics = _topic_names(topic_map, topic_query, limit=cfg["maxTopics"])

    # Per-PDF mode: a small explicit multi-PDF selection → one section per PDF,
    # deduped across them. The topic map still ranks the evidence in the
    # background. A single PDF (or a large "whole course" selection) uses the
    # topic-map-driven sheet instead.
    per_pdf = bool(document_ids and 2 <= len(document_ids) <= _MAX_PER_PDF_DOCS)
    by_doc: dict[str, list[dict[str, Any]]] = {}
    if per_pdf:
        per_doc_cap = max(4, _MAX_EVIDENCE // max(1, len(document_ids or [])))
        by_doc = _pool_evidence_by_doc(
            user_id=user_id, course_id=course_id,
            document_ids=document_ids or [], topics=topics, per_doc_cap=per_doc_cap,
        )
        evidence = [c for chunks in by_doc.values() for c in chunks]
    else:
        evidence = _pool_evidence(
            user_id=user_id, course_id=course_id, topics=topics, document_ids=document_ids,
        )
    evidence, evidence_quality = normalize_evidence_chunks(evidence)
    if not evidence:
        return {
            "text": "",
            "warning": "No relevant material found to build a cheatsheet from.",
            "groundedSources": [],
            "settings": cfg,
            "quality": {
                "evidenceNormalization": evidence_quality.__dict__,
            },
        }
    # Caller-supplied names (selected docs) take precedence; backfill the rest
    # so course-wide sheets still cite real filenames instead of "Unknown".
    merged_names = _backfill_doc_names(evidence, dict(doc_names or {}))

    if per_pdf:
        n_pdfs = len(by_doc)
        title = f"Cheatsheet — {n_pdfs} PDF" + ("s" if n_pdfs != 1 else "")
        user = "COURSE CONTEXT (grouped by source PDF):\n\n" + _format_evidence_by_doc(by_doc, merged_names)
        system = _settings_system_prompt(cfg, per_pdf=True)
    else:
        title = (topic_query + " — Cheatsheet") if topic_query else "Course Cheatsheet"
        user = "COURSE CONTEXT:\n\n" + _format_evidence(evidence, merged_names, topics)
        system = _settings_system_prompt(cfg)
    try:
        # Keep output bounded: at ~40 tok/s, output length is wall-clock, and the
        # edge proxy aborts at 45s. _MAX_TOKENS caps generation so a verbose sheet
        # can't run past the timeout ("Upstream AI service error").
        res = chat_json(system=system, user=user, max_tokens=_MAX_TOKENS, salvage_key="text")
    except Exception as e:  # noqa: BLE001
        log.exception("cheatsheet LLM call failed")
        return {"text": "", "error": str(e), "groundedSources": []}

    raw_text = (res.data.get("text") if isinstance(res.data, dict) else "") or ""
    text, dropped_formulas = sanitize_cheatsheet_markdown(raw_text)
    # Deterministic backstop so a repeated formula is GUARANTEED removed, even if
    # the model didn't dedup the per-PDF sections perfectly.
    text, deduped = dedup_display_formulas(text)
    text, unsupported_formulas = drop_unsupported_display_formulas(text, evidence)
    if dropped_formulas:
        log.info("cheatsheet sanitizer dropped %d malformed formula(s)", dropped_formulas)
    if deduped:
        log.info("cheatsheet dedup removed %d repeated formula(s)", deduped)
    if unsupported_formulas:
        log.info("cheatsheet source gate removed %d unsupported formula(s)", unsupported_formulas)
    grounding = formula_grounding(text, evidence)
    sources = [
        {
            "documentId": c.get("documentId"),
            "fileName": merged_names.get(c.get("documentId") or "", "Unknown"),
            "pageStart": c.get("pageStart"),
            "pageEnd": c.get("pageEnd"),
            "chunkId": c.get("chunkId"),
        }
        for c in evidence
    ]

    note_id: str | None = None
    if save and text.strip():
        # Course-wide cheatsheets have no single document_id; per-doc selections
        # of exactly one document keep the FK so it shows under that document.
        single_doc = document_ids[0] if document_ids and len(document_ids) == 1 else None
        note_id = save_note(
            user_id=user_id,
            course_id=course_id,
            document_id=single_doc,
            title=title,
            text=text,
            sources=sources,
            note_type="cheatsheet",
        )

    out: dict[str, Any] = {
        "noteId": note_id,
        "title": title,
        "text": text,
        "topicsCovered": [t for t in topics if t],
        "groundedSources": sources[:20],
        "settings": cfg,
        "grounding": grounding,
        "quality": {
            "evidenceNormalization": evidence_quality.__dict__,
            "droppedMalformedFormulas": dropped_formulas,
            "droppedUnsupportedFormulas": unsupported_formulas,
        },
        "model": res.model,
        "promptTokens": res.prompt_tokens,
        "completionTokens": res.completion_tokens,
    }
    # Build one honest warning from both signals (sanitizer drops + weak grounding).
    warns: list[str] = []
    if dropped_formulas:
        warns.append(
            f"{dropped_formulas} formula(s) were omitted because the source text "
            "was unreadable (likely scan/OCR quality)."
        )
    if evidence_quality.dropped_formula_lines:
        warns.append(
            f"{evidence_quality.dropped_formula_lines} corrupted formula line(s) "
            "were removed before generation."
        )
    if unsupported_formulas:
        warns.append(
            f"{unsupported_formulas} formula(s) were removed because they were not "
            "supported by the retrieved source text."
        )
    if grounding["ratio"] is not None and grounding["total"] >= 3 and grounding["ratio"] < 0.6:
        ungrounded = grounding["total"] - grounding["grounded"]
        warns.append(
            f"{ungrounded} of {grounding['total']} formulas could not be matched "
            "to your source text — double-check them before relying on the sheet."
        )
    if warns:
        out["citationWarning"] = " ".join(warns)
    return out


__all__ = (
    "generate_cheatsheet",
    "sanitize_cheatsheet_markdown",
    "dedup_display_formulas",
    "drop_unsupported_display_formulas",
    "normalize_settings",
    "formula_grounding",
)
