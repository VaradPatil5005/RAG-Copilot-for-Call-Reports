"""Authentication (Phase 6.3).

Replaces the Phase 4/5 local-dev shortcut of accepting `principals` as a
client-supplied request field (ADR 0006) with a real FastAPI auth
dependency: every protected request must present a `Bearer` JWT, verified
server-side, and the orchestrator builds the ACL filter from *that*
verified identity -- never from anything the client puts in the request
body. A request body no longer has a `principals` field at all (removed
from every affected router in this phase); there is nothing left to
forge there.

Local-dev substitution, documented like every other one in this project:
  - Real deployment:  the enterprise IdP (Azure AD/Entra ID) issues the
    JWT at login; this API verifies it against the IdP's JWKS and never
    issues tokens itself. `/auth/dev-token` would not exist.
  - This sandbox:      `/auth/dev-token` mints an HS256 JWT signed with
    `config.AUTH_SECRET` given a principal set, standing in for "the user
    already logged into the IdP" so the rest of the stack -- and every
    test -- can exercise the real verification path end-to-end. Gated by
    `config.AUTH_DEV_MODE`; a real deployment sets that False and the
    dev-token endpoint 404s.

`require_identity` is what routers depend on. It never trusts anything
from the request body -- only the `Authorization` header -- and rejects
(401) a missing, malformed, expired, or signature-tampered token. This is
what makes the Phase 6.3 test "a forged/tampered client-supplied
principal is rejected" true structurally, not just by convention: the
principals *only* ever come from a verified signature.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import jwt
from fastapi import Header, HTTPException

from app import config

ALGORITHM = "HS256"


@dataclass
class Identity:
    sub: str
    tenant_id: str
    principals: list[str] = field(default_factory=list)
    business_unit: str | None = None
    region: str | None = None


def create_dev_token(
    sub: str,
    tenant_id: str,
    principals: list[str],
    business_unit: str | None = None,
    region: str | None = None,
    ttl_seconds: int | None = None,
) -> str:
    """Local-dev-only token minting -- see module docstring. Never called
    from production request-handling code, only from `/auth/dev-token`
    (itself gated on `config.AUTH_DEV_MODE`) and from tests."""
    now = int(time.time())
    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "principals": principals,
        "business_unit": business_unit,
        "region": region,
        "iat": now,
        "exp": now + (ttl_seconds or config.AUTH_TOKEN_TTL_SECONDS),
    }
    return jwt.encode(payload, config.AUTH_SECRET, algorithm=ALGORITHM)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, config.AUTH_SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="token expired") from exc
    except jwt.InvalidTokenError as exc:
        # Covers a tampered/forged token: PyJWT raises InvalidSignatureError
        # (a subclass of InvalidTokenError) the moment the signature doesn't
        # verify against AUTH_SECRET, before any claim is trusted.
        raise HTTPException(status_code=401, detail="invalid token") from exc


def require_identity(authorization: str | None = Header(default=None)) -> Identity:
    """FastAPI dependency -- the *only* source of an authenticated
    identity for every protected route. No request body field can
    substitute for this."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    claims = _decode(token)
    return Identity(
        sub=claims.get("sub", "unknown"),
        tenant_id=claims.get("tenant_id", "tenant-a"),
        principals=claims.get("principals") or [],
        business_unit=claims.get("business_unit"),
        region=claims.get("region"),
    )


def optional_identity(authorization: str | None = Header(default=None)) -> Identity | None:
    """For routes/tests that should keep working unauthenticated during
    local development (e.g. the evaluation harness, which already scopes
    by tenant_id and is an internal/system caller, not an end-user
    request) -- returns None instead of 401 when no token is presented,
    but still verifies (rejects a bad token) if one *is* presented."""
    if not authorization:
        return None
    return require_identity(authorization)
