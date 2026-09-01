"""Local-dev auth endpoints (Phase 6.3).

`POST /auth/dev-token` mints a signed JWT for a given principal set --
standing in for "the user already authenticated with the enterprise IdP".
Gated by `config.AUTH_DEV_MODE`; a real deployment sets that False (or
removes this router entirely) and fronts the API with the actual IdP,
which issues tokens this service only ever verifies.

`GET /auth/whoami` is a convenience endpoint to confirm what identity a
given token actually resolves to server-side -- useful for the audit
trail work in the rest of 6.3 and for manual testing.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import config
from app.services import auth

router = APIRouter(prefix="/auth", tags=["auth"])


class DevTokenRequest(BaseModel):
    sub: str
    tenant_id: str = "tenant-a"
    principals: list[str] = []
    business_unit: str | None = None
    region: str | None = None


@router.post("/dev-token")
def issue_dev_token(req: DevTokenRequest) -> dict:
    if not config.AUTH_DEV_MODE:
        raise HTTPException(status_code=404, detail="dev-token issuance is disabled (AUTH_DEV_MODE=false)")
    token = auth.create_dev_token(
        sub=req.sub,
        tenant_id=req.tenant_id,
        principals=req.principals,
        business_unit=req.business_unit,
        region=req.region,
    )
    return {"access_token": token, "token_type": "bearer", "expires_in": config.AUTH_TOKEN_TTL_SECONDS}


@router.get("/whoami")
def whoami(identity: auth.Identity = Depends(auth.require_identity)) -> dict:
    return {
        "sub": identity.sub,
        "tenant_id": identity.tenant_id,
        "principals": identity.principals,
        "business_unit": identity.business_unit,
        "region": identity.region,
    }
