"""PDF text extraction via pdfminer.six.

Returns one cleaned string per page so the chunker can stamp page_start /
page_end on every chunk. No OCR fallback in v1 — scanned PDFs yield empty
pages and the indexer marks the doc as failed with a clear reason.
"""

from __future__ import annotations

import io
import logging
import re

from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer

log = logging.getLogger(__name__)


_WHITESPACE = re.compile(r"[ \t]+")
_MULTI_NEWLINE = re.compile(r"\n{3,}")
# pdfminer emits "(cid:NN)" for glyphs whose font lacks a ToUnicode map —
# common for math symbols (∫ → "(cid:90)", vector arrow → "(cid:126)") and
# ligature fonts. They're noise to every downstream consumer (chunking,
# embeddings, formula detection), so strip them at the source.
_CID_ARTIFACT = re.compile(r"\(cid:\d+\)")


def _clean_page_text(raw: str) -> str:
    """Tidy a single page's text — collapse spaces, normalise newlines.

    Deliberately minimal: aggressive cleaning is the chunker's job.
    """
    if not raw:
        return ""
    # Normalise CRLF, drop NUL bytes (pdfminer occasionally emits them).
    text = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    # Drop unmapped-glyph artifacts like "(cid:90)".
    text = _CID_ARTIFACT.sub("", text)
    # Collapse runs of spaces/tabs (preserves single line breaks).
    text = "\n".join(_WHITESPACE.sub(" ", line).strip() for line in text.split("\n"))
    # Cap any wall of blank lines at 2 newlines = one paragraph break.
    text = _MULTI_NEWLINE.sub("\n\n", text)
    return text.strip()


def extract_pages_text(pdf_bytes: bytes) -> list[str]:
    """Return cleaned text for every page in document order.

    Empty / image-only pages return an empty string in their slot so the
    caller still knows how many pages the PDF has.
    """
    if not pdf_bytes:
        return []

    pages: list[str] = []
    try:
        for page_layout in extract_pages(io.BytesIO(pdf_bytes)):
            parts: list[str] = []
            for element in page_layout:
                if isinstance(element, LTTextContainer):
                    parts.append(element.get_text())
            pages.append(_clean_page_text("".join(parts)))
    except Exception:
        log.exception("pdfminer extract_pages failed")
        raise

    return pages
