"""
security.py - Internal service authentication for ml-service (CONTRACTS section 6, T0.4 & T2.4).

Every endpoint except /health requires the header:
    X-Internal-Token: <INTERNAL_ML_TOKEN>
Uses hmac.compare_digest for constant-time comparison to prevent timing attacks.
"""
import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException, status


def get_internal_token() -> Optional[str]:
    """Return the configured INTERNAL_ML_TOKEN from environment."""
    return os.getenv("INTERNAL_ML_TOKEN")


def verify_internal_token(
    x_internal_token: Optional[str] = Header(default=None, alias="X-Internal-Token")
) -> None:
    """FastAPI dependency that enforces X-Internal-Token with constant-time comparison."""
    expected = get_internal_token()
    provided = x_internal_token or ""
    if (
        not provided
        or not expected
        or not expected.strip()
        or expected.strip().lower().startswith("change_me")
        or not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Internal-Token",
        )
