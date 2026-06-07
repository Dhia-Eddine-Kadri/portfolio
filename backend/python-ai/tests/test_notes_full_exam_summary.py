from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_env() -> None:
    os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")
    os.environ.setdefault("OPENAI_API_KEY", "stub")
    os.environ["INTERNAL_SECRET"] = "test-token"
    from app.config import get_settings  # noqa: WPS433

    get_settings.cache_clear()


def test_exam_section_prompt_covers_complete_page_group() -> None:
    from app.routers import notes_full

    prompt = notes_full._section_prompt("de", 3, 6, "summary", "exam")

    assert "Muss-Definitionen" in prompt
    assert "DIN-Einteilungen" in prompt
    assert "Werkstoffverhalten" in prompt
    assert "Kristallstruktur, Gleiten und Versetzungen" in prompt
    assert "Rekristallisation" in prompt
    assert "Typische Fehler" in prompt
    assert "Do not skip central theory pages" in prompt
    assert "explicit [S. X] markers" in prompt
    assert "$k_f$" in prompt
    assert "$A_1$" in prompt
    assert "$l_1$" in prompt
    assert "$l_0$" in prompt
    assert "\\ln\\left(\\frac{l_1}{l_0}\\right)" in prompt


def test_exam_merge_prompt_uses_required_final_structure() -> None:
    from app.routers import notes_full

    prompt = notes_full._merge_prompt("de", "summary", "exam")

    expected_headings = [
        "## 1. Muss-Definitionen",
        "## 2. DIN-Einteilungen",
        "## 6. Wichtige Formeln",
        "## 10. Typische Prüfungsfragen",
        "## 11. Typische Fehler",
    ]
    for heading in expected_headings:
        assert heading in prompt

    assert "Preserve exam-relevant content from EVERY input section" in prompt
    assert "If examples are on S. 6, keep S. 6" in prompt
    assert "$\\varphi$ with $\\varepsilon$" in prompt


def test_staged_merge_sends_all_sections_without_silent_truncation(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.routers import notes_full

    calls: list[str] = []

    def fake_call_openai(system_prompt: str, user_message: str, max_tokens: int = 4000) -> str:
        calls.append(user_message)
        return "<!-- minallo-summary-type: study-content -->\n" + user_message

    monkeypatch.setattr(notes_full, "_call_openai", fake_call_openai)

    parts = [
        f"=== SECTION {i} ===\n\nPAGE_TOKEN_{i} " + ("x" * 70)
        for i in range(6)
    ]

    result = notes_full._merge_with_staging("system", "Merge:\n\n", parts, max_chars=180, max_tokens=1000)

    sent_text = "\n".join(calls)
    for i in range(6):
        assert f"PAGE_TOKEN_{i}" in sent_text

    assert calls[0].find("PAGE_TOKEN_0") != -1
    assert "PAGE_TOKEN_5" in sent_text
    assert result.startswith("<!-- minallo-summary-type: study-content -->")
