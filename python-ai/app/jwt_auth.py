"""Verify Supabase user JWTs.

Used by the streaming /ask endpoint, which the browser calls directly
(no Netlify hop) so the connection stays open for SSE. The token comes
in as `Authorization: Bearer <jwt>` and is verified against Supabase's
auth API the same way backend/lib/supabase-auth.js does it.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import Header, HTTPException, status

from .config import get_settings

log = logging.getLogger(__name__)


async def verify_supabase_jwt(authorization: str = Header(default="")) -> dict[str, Any]:
    """Return the verified Supabase user dict (id, email, …) or raise 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Empty token")

    settings = get_settings()
    url = settings.supabase_url.rstrip("/") + "/auth/v1/user"
    # The "apikey" header is required by Supabase Auth even on this endpoint —
    # service-role works fine and is already in our env.
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.supabase_service_role_key,
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, headers=headers)
    except httpx.HTTPError as e:
        log.warning("supabase auth verify network error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth verification temporarily unavailable",
        )
    if r.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    try:
        user = r.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed auth response")
    if not user or not user.get("id"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No user id on token")
    return user
