"""Tests for the pdfminer text cleaner (CID-artifact stripping, whitespace)."""

from __future__ import annotations

from app.services.extraction import _clean_page_text


def test_strips_cid_glyph_artifacts() -> None:
    """pdfminer emits '(cid:NN)' for unmapped glyphs (∫, vector arrows,
    ligature fonts). They must not survive into the cleaned text."""
    raw = "dv = a dt (cid:90)(cid:90) dv = a dt the vector (cid:126)r describes"
    cleaned = _clean_page_text(raw)
    assert "(cid:" not in cleaned
    assert "dv = a dt" in cleaned
    # The vector name 'r' immediately follows its dropped arrow artifact.
    assert "vector r describes" in cleaned


def test_clean_page_text_collapses_whitespace_and_blanks() -> None:
    raw = "foo    bar\t\tbaz\n\n\n\nnext"
    cleaned = _clean_page_text(raw)
    assert "foo bar baz" in cleaned
    assert "\n\n\n" not in cleaned


def test_clean_page_text_empty() -> None:
    assert _clean_page_text("") == ""
