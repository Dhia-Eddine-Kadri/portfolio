"""Shared JSON-mode chat completion helper used by quiz / flashcards / notes.

Wraps the OpenAI client with:
  - response_format = json_object so the model is forced to return JSON.
  - Robust parse: strips fenced markdown if the model still wraps the JSON.
  - Returns (parsed_dict, prompt_tokens, completion_tokens, model_used).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from ..config import get_settings


_FENCE_OPEN = re.compile(r"^\s*```(?:json)?\s*", re.IGNORECASE)
_FENCE_CLOSE = re.compile(r"\s*```\s*$")


def _parse_json_lenient(text: str) -> Any:
    s = (text or "").strip()
    s = _FENCE_OPEN.sub("", s)
    s = _FENCE_CLOSE.sub("", s)
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", s)
        if not m:
            raise
        return json.loads(m.group(0))


@dataclass
class LlmResult:
    data: Any
    model: str
    prompt_tokens: int | None
    completion_tokens: int | None


def chat_json(
    *,
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 2000,
) -> LlmResult:
    settings = get_settings()
    chosen = model or settings.openai_generate_model
    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.chat.completions.create(
        model=chosen,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    )
    choice = resp.choices[0] if resp.choices else None
    text = (choice.message.content if choice and choice.message else "") or ""
    parsed = _parse_json_lenient(text)
    return LlmResult(
        data=parsed,
        model=chosen,
        prompt_tokens=resp.usage.prompt_tokens if resp.usage else None,
        completion_tokens=resp.usage.completion_tokens if resp.usage else None,
    )
