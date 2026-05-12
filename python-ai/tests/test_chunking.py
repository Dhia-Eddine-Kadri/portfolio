"""Unit tests for the chunker. No network, no DB."""

from __future__ import annotations

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_env() -> None:
    import os
    os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")
    os.environ.setdefault("OPENAI_API_KEY", "stub")
    os.environ.setdefault("INTERNAL_SECRET", "stub")


def test_chunk_pages_emits_chunks_in_page_order() -> None:
    from app.services.chunking import chunk_pages

    pages = [
        # page 1 — single paragraph well under the budget
        "Newton's second law states that force equals mass times acceleration. "
        "This is the foundation of classical mechanics. " * 6,
        # page 2 — a heading then a paragraph
        "1.2 Examples\n\nA block of mass 2 kg is pushed with 10 N of force. "
        "Compute its acceleration using F = ma. " * 8,
    ]
    chunks = chunk_pages(pages, target_tokens=200, overlap_tokens=20)

    assert chunks, "expected at least one chunk"
    # Chunks should appear in page order.
    page_starts = [c.page_start for c in chunks]
    assert page_starts == sorted(page_starts)
    # Every chunk should have a real text payload.
    for c in chunks:
        assert c.chunk_text.strip()
        assert c.token_count > 0
        assert 1 <= c.page_start <= 2
        assert c.page_end >= c.page_start


def test_chunk_pages_classifies_examples() -> None:
    from app.services.chunking import chunk_pages

    # Long paragraph mentioning "example" — chunker should tag it.
    pages = [
        "1. Example\n\nExample: Given F = 10 N and m = 2 kg, find the acceleration. "
        "Worked example with numeric values for the student to verify. " * 12
    ]
    chunks = chunk_pages(pages, target_tokens=200, overlap_tokens=20)
    assert chunks
    # The heading was eaten, the paragraph remains; classification should
    # see "example" / "Example:" and tag accordingly.
    assert any(c.chunk_type == "example" for c in chunks)


def test_chunk_pages_handles_empty_input() -> None:
    from app.services.chunking import chunk_pages

    assert chunk_pages([]) == []
    assert chunk_pages(["", "   ", ""]) == []


def test_chunk_pages_respects_target_token_budget() -> None:
    from app.services.chunking import chunk_pages

    # Two long paragraphs on the same page — should split into multiple chunks.
    pages = ["A long paragraph repeated many times. " * 200]
    chunks = chunk_pages(pages, target_tokens=200, overlap_tokens=30)
    assert len(chunks) >= 2
    # No chunk should grossly exceed the budget. Allow some headroom because
    # the chunker only flushes *before* adding the next paragraph.
    for c in chunks:
        assert c.token_count <= 400
