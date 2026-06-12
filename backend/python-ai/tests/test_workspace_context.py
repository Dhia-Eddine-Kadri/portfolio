"""Pure-function tests for the live workspace context layer."""

from __future__ import annotations

from app.services.workspace_context import (
    ALLOWED_AI_ACTIONS,
    ACTIONS_CONTRACT,
    detect_assistant_mode,
    format_account_block,
    format_workspace_block,
    is_workspace_question,
    sanitize_page_context,
    workspace_fingerprint,
)


def _snapshot() -> dict:
    return {
        "files": {"count": 7, "recent": ["Mechanik2.pdf", "Uebung_3.pdf"]},
        "quiz": {"count": 3, "recent": ["Kapitel 1"]},
        "flashcards": {"decks": 2, "cards": 42, "recent": ["Definitionen"]},
        "examforge": {"count": 1, "latest": "Probeklausur", "latestScore": 78},
        "cheatsheet": {"count": 1, "recent": ["Formelsammlung"]},
        "deeplearn": {"count": 2, "recent": ["Biegung"]},
    }


# ── format_workspace_block ───────────────────────────────────────────────────

def test_block_contains_real_counts_and_exact_tab_names():
    block = format_workspace_block(_snapshot())
    assert "7 document(s)" in block
    assert "3 quiz(zes)" in block
    assert "2 deck(s), 42 cards" in block
    assert '"Probeklausur" (score 78)' in block
    for tab in ("Files", "Quiz", "Flashcards", "ExamForge", "Cheatsheet", "Deep Learn"):
        assert tab in block
    # The anti-hallucination rule must always ride along.
    assert "NEVER invent" in block


def test_block_includes_location_and_weak_topics():
    block = format_workspace_block(
        _snapshot(),
        page_context={"courseName": "EngMech 2", "activeTab": "quiz"},
        weak_topics=["Torsion", "Knickung"],
    )
    assert 'in the course "EngMech 2"' in block
    assert "on the Quiz tab" in block
    assert "Torsion" in block and "Knickung" in block


def test_block_includes_activity_and_study_stats():
    snap = _snapshot()
    snap["activity"] = {
        "openedFiles": ["Mechanik2.pdf"],
        "aiSessions": 4,
        "lastOpenedAt": "2026-06-11",
    }
    snap["study"] = {"minutes": 412, "streak": 5}
    block = format_workspace_block(snap)
    assert "course last opened 2026-06-11" in block
    assert "4 AI session(s)" in block
    assert '"Mechanik2.pdf"' in block
    assert "412 min total study time, 5-day streak" in block


def test_account_block_lists_real_courses_only():
    block = format_account_block({
        "courses": [
            {"id": "tm2", "name": "TM2", "files": 12},
            {"id": "ft", "name": "Fertigungstechnik", "files": 0},
        ]
    })
    assert '"TM2" (12 file(s) uploaded)' in block
    assert '"Fertigungstechnik" (no files yet)' in block
    assert "never invent" in block
    assert format_account_block(None) == ""
    assert format_account_block({"courses": []}) == ""


def test_block_empty_when_nothing_known():
    assert format_workspace_block(None) == ""
    assert format_workspace_block(None, page_context={}, weak_topics=[]) == ""


def test_fingerprint_changes_with_data_and_is_stable():
    snap = _snapshot()
    a = workspace_fingerprint(snap)
    b = workspace_fingerprint(snap)
    assert a == b and len(a) == 16
    snap["quiz"]["count"] = 4
    assert workspace_fingerprint(snap) != a
    assert workspace_fingerprint(None) == ""


# ── sanitize_page_context ────────────────────────────────────────────────────

def test_page_context_sanitises_and_validates():
    out = sanitize_page_context({
        "page": "pdf-viewer",
        "activeTab": "ExamForge",          # case-normalised
        "courseName": "  EngMech 2  ",
        "documentTitle": "x" * 999,
        "unknown": "dropped",
    })
    assert out["page"] == "pdf-viewer"
    assert out["activeTab"] == "examforge"
    assert out["courseName"] == "EngMech 2"
    assert len(out["documentTitle"]) == 160
    assert "unknown" not in out


def test_page_context_rejects_bad_values():
    out = sanitize_page_context({"page": "<script>", "activeTab": "not-a-tab"})
    assert "page" not in out and "activeTab" not in out
    assert sanitize_page_context(None) == {}
    assert sanitize_page_context("nope") == {}  # type: ignore[arg-type]


# ── mode + workspace-question detection ──────────────────────────────────────

def test_exam_coach_detection():
    assert detect_assistant_mode("Prepare me for the exam") == "exam_coach"
    assert detect_assistant_mode("can you make me a study plan?") == "exam_coach"
    assert detect_assistant_mode("What should I study next?") == "exam_coach"
    assert detect_assistant_mode("Wie bereite ich mich auf die Klausur vor? Prüfungsvorbereitung bitte") == "exam_coach"


def test_tutor_detection():
    assert detect_assistant_mode("teach me eigenvalues step by step") in ("tutor", "exam_coach")
    assert detect_assistant_mode("walk me through this derivation") == "tutor"
    assert detect_assistant_mode("Erkläre es Schritt für Schritt") == "tutor"


def test_plain_content_questions_have_no_mode():
    assert detect_assistant_mode("What is the shear stress in Aufgabe 3?") is None
    assert detect_assistant_mode("") is None


def test_workspace_question_detection():
    assert is_workspace_question("Where are my flashcards?")
    assert is_workspace_question("Which quizzes did I complete?")
    assert is_workspace_question("What can I do in this course?")
    assert is_workspace_question("which topics am I weak in?")
    assert not is_workspace_question("What is the moment of inertia of a beam?")
    assert not is_workspace_question("")


def test_actions_contract_only_names_allowed_actions():
    # Every action id mentioned in the contract text must be allowlisted —
    # the frontend renderer drops anything else silently.
    import re
    mentioned = set(re.findall(r"\b(open_[a-z_]+|generate_[a-z_]+|start_[a-z_]+|create_[a-z_]+|review_[a-z_]+)\b", ACTIONS_CONTRACT))
    assert mentioned <= set(ALLOWED_AI_ACTIONS)
    assert "generate_flashcards" in mentioned
