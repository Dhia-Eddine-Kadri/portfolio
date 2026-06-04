"""ExamForge generation and grading.

V1 focuses on reliable course-grounded MCQ exams. It reuses the quiz
generation pipeline because that path already has retrieval, topic labels,
source attribution, strict counts, and deterministic backfill.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from .quiz import _fetch_course_topics, generate_quiz
from ..supabase_client import get_supabase

log = logging.getLogger(__name__)


_LETTERS = ("A", "B", "C", "D")


def _option_array(options: Any) -> list[str]:
    if isinstance(options, list):
        return [str(x or "") for x in options[:4]]
    if isinstance(options, dict):
        return [str(options.get(letter) or "") for letter in _LETTERS]
    return []


def _source_page(source: str | None) -> str | None:
    if not source:
        return None
    parts = [p.strip() for p in source.split(",")]
    return parts[-1] if len(parts) > 1 else None


def _source_doc(source: str | None) -> str | None:
    if not source:
        return None
    return source.split(",")[0].strip() or None


def _normalise_question(row: dict[str, Any], question_id: str | None = None) -> dict[str, Any]:
    options = _option_array(row.get("options"))
    answer = row.get("answer")
    if isinstance(answer, int) and 0 <= answer < len(_LETTERS):
        answer = _LETTERS[answer]
    answer = str(answer or "").strip().upper()[:1]
    if answer not in _LETTERS:
        answer = "A"
    source = row.get("source")
    return {
        "id": question_id,
        "type": row.get("type") or "mcq",
        "question": row.get("question") or "",
        "options": options,
        "answer": answer,
        "explanation": row.get("explanation") or "",
        "difficulty": row.get("difficulty") or "medium",
        "topic": row.get("topic"),
        "points": int(row.get("points") or 1),
        "source": source,
        "sources": [{
            "fileName": _source_doc(source),
            "pages": _source_page(source),
        }] if source else [],
        "validation": {
            "status": row.get("validation_status") or "grounded",
            "score": row.get("validation_score") or 1,
        },
    }


def generate_examforge(
    *,
    user_id: str,
    course_id: str,
    document_ids: list[str] | None,
    requested_count: int,
    difficulty: str,
    topic: str | None,
    doc_names: dict[str, str],
) -> dict[str, Any]:
    requested = max(1, min(int(requested_count or 6), 20))
    diff = difficulty if difficulty in ("easy", "medium", "hard", "mixed") else "medium"
    topic_query = (topic or "").strip()
    quiz_out = generate_quiz(
        user_id=user_id,
        course_id=course_id,
        document_ids=document_ids,
        requested_count=requested,
        difficulty=diff,
        question_types=["mcq"],
        doc_names=doc_names,
    )
    questions = [_normalise_question(q) for q in quiz_out.get("questions", [])]

    sb = get_supabase()
    session_id: str | None = None
    saved_questions: list[dict[str, Any]] = questions
    if questions:
        try:
            session_resp = sb.table("exam_sessions").insert({
                "user_id": user_id,
                "course_id": course_id,
                "title": topic_query or "ExamForge",
                "difficulty": diff,
                "question_count": len(questions),
                "question_types": ["mcq"],
                "source_document_ids": document_ids or None,
                "topic": topic_query or None,
                "status": "ready",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            session_id = session_resp.data[0]["id"]
            question_rows = []
            for idx, q in enumerate(questions):
                src = (q.get("sources") or [{}])[0] if isinstance(q.get("sources"), list) else {}
                question_rows.append({
                    "exam_session_id": session_id,
                    "user_id": user_id,
                    "position": idx,
                    "question_type": q["type"],
                    "topic": q.get("topic"),
                    "difficulty": q.get("difficulty") or diff,
                    "points": q.get("points") or 1,
                    "question_text": q["question"],
                    "options": q.get("options") or [],
                    "correct_answer": q.get("answer") or "A",
                    "explanation": q.get("explanation") or "",
                    "source_document_names": [src.get("fileName")] if src.get("fileName") else None,
                    "source_pages": [src.get("pages")] if src.get("pages") else None,
                    "validation_status": "grounded",
                    "validation_score": 1,
                })
            saved_resp = sb.table("exam_questions").insert(question_rows).execute()
            saved_rows = saved_resp.data or []
            if saved_rows:
                saved_questions = [
                    {**questions[idx], "id": row.get("id")}
                    for idx, row in enumerate(saved_rows)
                    if idx < len(questions)
                ]
        except Exception:
            log.exception("examforge persistence failed")

    topics = _fetch_course_topics(course_id, document_ids)
    return {
        "sessionId": session_id,
        "title": topic_query or "ExamForge",
        "requestedCount": requested,
        "actualCount": len(saved_questions),
        "questions": saved_questions,
        "topicMap": [{"name": t} for t in topics[:24]],
        "groundedSources": quiz_out.get("groundedSources", []),
        "warning": quiz_out.get("warning"),
        "model": quiz_out.get("model"),
        "promptTokens": quiz_out.get("promptTokens"),
        "completionTokens": quiz_out.get("completionTokens"),
    }


def grade_examforge_answer(
    *,
    user_id: str,
    exam_session_id: str,
    exam_question_id: str,
    user_answer: str,
) -> dict[str, Any]:
    sb = get_supabase()
    q_resp = (
        sb.table("exam_questions")
        .select("id, exam_session_id, user_id, correct_answer, explanation, points")
        .eq("id", exam_question_id)
        .eq("exam_session_id", exam_session_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = q_resp.data or []
    if not rows:
        return {"ok": False, "error": "question not found"}
    q = rows[0]
    submitted = (user_answer or "").strip().upper()[:1]
    correct = str(q.get("correct_answer") or "").strip().upper()[:1]
    is_correct = submitted == correct
    score = float(q.get("points") or 1) if is_correct else 0.0
    feedback = "Correct." if is_correct else "Not quite. " + (q.get("explanation") or "")
    try:
        sb.table("exam_answers").insert({
            "exam_question_id": exam_question_id,
            "exam_session_id": exam_session_id,
            "user_id": user_id,
            "user_answer": submitted,
            "is_correct": is_correct,
            "score": score,
            "feedback": feedback,
        }).execute()
    except Exception:
        log.exception("examforge answer save failed")
    return {
        "ok": True,
        "isCorrect": is_correct,
        "score": score,
        "correctAnswer": correct,
        "feedback": feedback,
    }
