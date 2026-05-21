"""Phase 12 — OCR / vision fallback for image-only PDF pages.

Pipeline:

    PDF page → rendered image → vision-capable LLM → Markdown text

Only runs when:
  * ``settings.vision_ocr_enabled`` is True (env: ``MINALLO_VISION_OCR_ENABLED``)
  * the Phase 11 detector flagged ``ocr_recommended``
  * the rendering library (``pypdfium2``) is importable

Otherwise the function returns an empty mapping and the indexer keeps
the original (possibly empty) pdfminer text. The whole module degrades
gracefully when:
  * pypdfium2 is not installed (no dep is forced on the deploy)
  * OpenAI vision returns an error
  * a single page render fails

Page indices in/out are 0-based to match ``extract_pages_text``'s slot
ordering.
"""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Iterable

from ..config import get_settings

log = logging.getLogger(__name__)


# Rendering and OpenAI are imported lazily so the module is still
# importable in deploys that haven't installed the optional deps.
def _try_import_pypdfium2():
    try:
        import pypdfium2 as pdfium  # type: ignore[import-not-found]
        return pdfium
    except Exception:  # noqa: BLE001
        return None


def _try_import_openai():
    try:
        from openai import OpenAI  # type: ignore[import-not-found]
        return OpenAI
    except Exception:  # noqa: BLE001
        return None


_VISION_SYSTEM_PROMPT = (
    "You are an OCR + structure extraction system. The user will send a "
    "single page image from a course PDF. Extract every readable line of "
    "text, math, and diagram labels into clean Markdown.\n"
    "\n"
    "Rules:\n"
    "1. Use ATX headings (#, ##) for visually-large headings.\n"
    "2. Wrap every formula in $$ ... $$ display math fences.\n"
    "3. Preserve bullet lists with `-`.\n"
    "4. If a region is genuinely unreadable, write `[unclear]` — do NOT "
    "invent content.\n"
    "5. Return Markdown only — no commentary, no JSON wrapper."
)


def _render_page_to_png(pdfium, pdf_bytes: bytes, page_index: int, dpi: int) -> bytes | None:
    """Render one 0-based page index to PNG bytes. None on failure."""
    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
        try:
            if page_index < 0 or page_index >= len(pdf):
                return None
            page = pdf[page_index]
            # pypdfium2 uses scale (points/inch). 72 pts = 1 inch.
            scale = dpi / 72.0
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil()
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            return buf.getvalue()
        finally:
            pdf.close()
    except Exception:  # noqa: BLE001
        log.exception("pypdfium2 render failed for page %s", page_index)
        return None


def _vision_extract(client, model: str, image_bytes: bytes) -> str:
    """One vision-model call. Returns extracted Markdown or "" on failure."""
    try:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        response = client.chat.completions.create(
            model=model,
            max_tokens=2000,
            messages=[
                {"role": "system", "content": _VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract the page content as Markdown."},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        },
                    ],
                },
            ],
        )
        msg = response.choices[0].message if response.choices else None
        raw = (msg.content if msg else "") or ""
        return _strip_outer_code_fence(raw)
    except Exception:  # noqa: BLE001
        log.exception("vision OCR call failed")
        return ""


# Vision models reliably wrap their answer in a markdown code fence even
# though the prompt explicitly asks for Markdown content (the fence is
# how the chat model "shows" markdown). Without stripping, downstream
# parsing sees ```markdown ## b) $$ F_A=... ``` as one flat code-block
# line and never recognises the heading or the $$ math inside.
_CODE_FENCE_RE = re.compile(
    r"^\s*```(?:markdown|md)?\s*\n(.*?)\n\s*```\s*$",
    re.DOTALL | re.IGNORECASE,
)


def _strip_outer_code_fence(text: str) -> str:
    """If the vision response is wrapped in an outer ```markdown ... ```
    code fence, return the inner content. No-op for already-bare Markdown."""
    if not text:
        return text
    m = _CODE_FENCE_RE.match(text)
    if m:
        return m.group(1).strip()
    return text


def pages_via_vision(pdf_bytes: bytes, page_indices: Iterable[int]) -> dict[int, str]:
    """Run vision OCR on the given 0-based page indices.

    Returns ``{page_index: markdown}`` only for pages that succeeded. The
    indexer should ``original_pages[idx] = result[idx]`` for each key in
    the dict and leave the rest alone.

    Silently returns ``{}`` when:
      * the feature flag is off
      * pypdfium2 isn't installed
      * the openai SDK isn't installed
    """
    settings = get_settings()
    if not settings.vision_ocr_enabled:
        log.debug("vision OCR disabled by flag — skipping")
        return {}

    pdfium = _try_import_pypdfium2()
    if pdfium is None:
        log.warning("vision OCR requested but pypdfium2 is not installed")
        return {}

    OpenAI = _try_import_openai()
    if OpenAI is None:
        log.warning("vision OCR requested but openai SDK is not installed")
        return {}

    indices = list(page_indices)
    if not indices:
        return {}
    if len(indices) > settings.vision_ocr_max_pages:
        log.warning(
            "vision OCR capped at %d pages (asked for %d)",
            settings.vision_ocr_max_pages, len(indices),
        )
        indices = indices[: settings.vision_ocr_max_pages]

    client = OpenAI(api_key=settings.openai_api_key)
    out: dict[int, str] = {}
    for idx in indices:
        png = _render_page_to_png(pdfium, pdf_bytes, idx, settings.vision_ocr_render_dpi)
        if not png:
            continue
        text = _vision_extract(client, settings.vision_ocr_model, png)
        if text and text.strip():
            out[idx] = text.strip()
    return out


def _looks_structurally_garbled(text: str) -> bool:
    """A page that has plenty of characters but no usable structure.

    Symptom: pdfminer pulled tokens out of reading order from a multi-column
    table or boxed-formula layout. Letter count passes the main ``letters
    < 80`` bar, but the result is gibberish from the model's perspective —
    fractions collapsed, formula→label pairs separated, short identifier
    fragments interleaved.

    Concrete case the heuristic was tuned against (Formelzettel page 8):

        ``δK = ′ lK ES ⋅ AN ′ = 0,5 ⋅ d lK δi = li ES ⋅ Ai δG = 0,5 ⋅ d ES ⋅ A3 …``

    pdfminer's text count says "1474 chars, looks fine", but no model can
    parse that back into the proper ``δ_K = l'_K / (E_S · A_N)`` form
    because the fraction operators are gone and the label column got
    appended to the end of the page.

    The four signals together — formula-heavy (`=`), fraction-starved
    (few `/`), math-flavoured (Greek/operators), and short-token-dense
    (formula fragments) — make false positives unlikely:

      * A prose page with one ``F = ma`` has too few ``=`` (< 4).
      * A list of numerical results (``Wert 1 = 5 mm``) lacks Greek /
        math-operator characters → ``has_math_signal`` False.
      * A clean formula sheet has roughly one ``/`` per ``=`` →
        ``fraction_starved`` False.
    """
    if not text or len(text) < 200:
        return False

    eq_count = text.count("=")
    if eq_count < 4:
        return False  # not a formula-heavy page

    # Look at WHAT comes right after each `=`. On a clean formula sheet
    # almost every `=` is followed within ~15 chars by a fraction marker
    # — `/`, `(`, or `\frac` — because formulas resolve to a bracketed
    # or divided expression. On a column-collapsed extraction the
    # fraction operators are gone, so the RHS is just identifier soup.
    #
    # NB: we deliberately do NOT just count `/` globally — German PDFs
    # have many `/` characters as German/English label separators
    # (e.g. "Vorspannkraftverlust / loss of preload"), which would
    # otherwise hide a genuinely garbled formula run from the heuristic.
    clean_rhs_count = 0
    for m in re.finditer(r"=", text):
        window = text[m.end(): m.end() + 15]
        if "/" in window or "(" in window or "\\frac" in window:
            clean_rhs_count += 1
    # Garbled when fewer than a third of `=` have a fraction-shaped RHS.
    if clean_rhs_count * 3 >= eq_count:
        return False

    # Require some formula DNA — Greek letters or math-typesetting
    # operators (⋅ ± ≤ ≥ ≈ ∑ ∫). Without this, ``Wert 1 = 5 mm`` style
    # numeric lists get false-positive flagged.
    has_math_signal = bool(re.search(r"[α-ωΑ-Ω]|⋅|±|≤|≥|≈|∑|∫", text))
    if not has_math_signal:
        return False

    # Short-token density. Formula sheets that LOST structure dissolve
    # into a soup of 1-3-char identifiers (δK, lK, ES, AN, …). A coherent
    # prose paragraph has plenty of multi-char German/English words.
    tokens = re.findall(r"\w+", text)
    if not tokens:
        return False
    short_tokens = sum(1 for t in tokens if 1 <= len(t) <= 3)
    short_ratio = short_tokens / len(tokens)
    return short_ratio > 0.45


def select_pages_needing_ocr(pages: list[str]) -> list[int]:
    """Helper for the indexer: returns the 0-based indices of pages that
    look bad enough to retry with vision OCR.

    Two failure modes covered:
      * Image-heavy / scanned page  → pdfminer extracts < 80 letters
      * Structurally garbled page   → plenty of text but column / fraction
        order is destroyed (formula sheets, multi-col tables). Caught by
        ``_looks_structurally_garbled``.
    """
    bad: list[int] = []
    for i, text in enumerate(pages):
        if not text:
            bad.append(i)
            continue
        letters = sum(1 for c in text if c.isalpha())
        if letters < 80:
            bad.append(i)
            continue
        if _looks_structurally_garbled(text):
            bad.append(i)
    return bad


__all__ = ("pages_via_vision", "select_pages_needing_ocr")
