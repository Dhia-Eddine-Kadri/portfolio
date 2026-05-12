"""Pure-function tests for retrieval reranking. No network, no DB."""

from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_env() -> None:
    os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")
    os.environ.setdefault("OPENAI_API_KEY", "stub")
    os.environ.setdefault("INTERNAL_SECRET", "stub")


def test_study_score_prefers_solution_over_other() -> None:
    from app.services.retrieval import _study_score

    solution = {"similarity": 0.5, "source_type": "solution", "chunk_text": "Solution: F = m*a", "is_official": True}
    other    = {"similarity": 0.5, "source_type": "other",    "chunk_text": "Random sentence.", "is_official": False}
    assert _study_score(solution) > _study_score(other)


def test_study_score_penalises_toc_lines() -> None:
    from app.services.retrieval import _study_score

    toc_chunk    = {"similarity": 0.4, "source_type": "lecture", "chunk_text": "1 ........... 5\n2 ........... 12"}
    real_content = {"similarity": 0.4, "source_type": "lecture", "chunk_text": "Definition: force = mass times acceleration. Apply F = m * a."}
    assert _study_score(real_content) > _study_score(toc_chunk)


def test_study_score_boosts_formula_text() -> None:
    from app.services.retrieval import _text_study_score

    score_with_formula = _text_study_score("The kinematic equation is v = u + a*t which we apply.")
    score_plain = _text_study_score("This is a normal sentence with no formulas.")
    assert score_with_formula > score_plain
