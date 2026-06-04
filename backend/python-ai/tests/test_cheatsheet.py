"""Unit tests for Cheatsheet generation (Learning Agent Phase 4).

Topic selection is tested directly; generation uses fake retrieval / LLM / save
so no real DB or LLM calls happen.
"""

from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")
os.environ.setdefault("OPENAI_API_KEY", "stub")

from app.services import cheatsheet as cs  # noqa: E402


# ── topic selection ─────────────────────────────────────────────────────────


def test_topic_names_focus_overrides_map():
    tm = [{"name": "Friction"}, {"name": "Momentum"}]
    assert cs._topic_names(tm, "Energy") == ["Energy"]


def test_topic_names_uses_map_capped():
    tm = [{"name": f"T{i}"} for i in range(30)]
    out = cs._topic_names(tm, None)
    assert len(out) == cs._MAX_TOPICS
    assert out[0] == "T0"


def test_topic_names_empty_map():
    assert cs._topic_names([], None) == [None]


# ── generation ──────────────────────────────────────────────────────────────


class _FakeChatResult:
    def __init__(self, data):
        self.data = data
        self.model = "fake-model"
        self.prompt_tokens = 5
        self.completion_tokens = 50


def test_generate_cheatsheet_grounded(monkeypatch):
    monkeypatch.setattr(cs, "get_course_topic_map", lambda u, c: [{"name": "Friction"}])

    def _fake_retrieve(**k):
        assert k["purpose"] == "cheatsheet"
        return [
            {"chunkId": "c1", "documentId": "d1", "pageStart": 4, "text": "F = μN"},
            {"chunkId": "c2", "documentId": "d1", "pageStart": 5, "text": "Static vs kinetic"},
        ]

    monkeypatch.setattr(cs, "retrieve_learning_context", _fake_retrieve)
    monkeypatch.setattr(cs, "chat_json", lambda **k: _FakeChatResult({"text": "## Friction\n- $F=\\mu N$ (a.pdf, p.4)"}))
    saved = {}
    def _fake_save(**k):
        saved.update(k)
        return "note-123"
    monkeypatch.setattr(cs, "save_note", _fake_save)

    out = cs.generate_cheatsheet(
        user_id="u", course_id="c", document_ids=["d1"], topic=None,
        doc_names={"d1": "a.pdf"}, save=True,
    )
    assert out["noteId"] == "note-123"
    assert out["topicsCovered"] == ["Friction"]
    assert "Friction" in out["text"]
    assert out["model"] == "fake-model"
    # grounded sources carry the filename + chunk linkage
    assert out["groundedSources"][0]["fileName"] == "a.pdf"
    assert out["groundedSources"][0]["chunkId"] == "c1"
    # saved as a cheatsheet-typed note
    assert saved["note_type"] == "cheatsheet"
    assert saved["title"] == "Course Cheatsheet"


def test_generate_cheatsheet_no_evidence_warns(monkeypatch):
    monkeypatch.setattr(cs, "get_course_topic_map", lambda u, c: [])
    monkeypatch.setattr(cs, "retrieve_learning_context", lambda **k: [])
    called = {"chat": 0, "save": 0}
    monkeypatch.setattr(cs, "chat_json", lambda **k: called.__setitem__("chat", called["chat"] + 1))
    monkeypatch.setattr(cs, "save_note", lambda **k: called.__setitem__("save", called["save"] + 1))

    out = cs.generate_cheatsheet(
        user_id="u", course_id="c", document_ids=None, topic=None, doc_names={}, save=True,
    )
    assert out["text"] == ""
    assert out["warning"]
    assert called["chat"] == 0  # no LLM call when there's nothing to ground in
    assert called["save"] == 0


def test_generate_cheatsheet_topic_focus_titles(monkeypatch):
    monkeypatch.setattr(cs, "get_course_topic_map", lambda u, c: [{"name": "Other"}])
    monkeypatch.setattr(
        cs, "retrieve_learning_context",
        lambda **k: [{"chunkId": "c1", "documentId": "d1", "pageStart": 1, "text": "x"}],
    )
    monkeypatch.setattr(cs, "chat_json", lambda **k: _FakeChatResult({"text": "## Energy\n- stuff"}))
    monkeypatch.setattr(cs, "save_note", lambda **k: "n1")

    out = cs.generate_cheatsheet(
        user_id="u", course_id="c", document_ids=["d1"], topic="Energy",
        doc_names={"d1": "a.pdf"}, save=True,
    )
    assert out["title"] == "Energy — Cheatsheet"
    assert out["topicsCovered"] == ["Energy"]
