"""HTTP-layer hardening applied to every request (registered in main.py).

- Security response headers (no sniffing, no framing, no referrer leak,
  no caching of API responses that may contain confidential data).
- Per-client-IP fixed-window rate limiting, with a much tighter budget on
  uploads and on endpoints that are expensive (LLM calls, reindex,
  evaluation). In-process memory only -- correct for a single API
  instance; a multi-instance deployment must move this to Redis or the
  edge (see the scaling notes in docs/SECURITY_HARDENING.md).
- A hard cap on request body size enforced from Content-Length before
  the body is read, so a client can't make the server buffer gigabytes.

`X-Forwarded-For` is only honoured when TRUST_PROXY_HEADERS=true, i.e.
when the API is deployed behind a reverse proxy that overwrites it --
otherwise any client could pick a fresh "IP" per request and bypass the
limiter.
"""
from __future__ import annotations

import threading
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app import config
from app.services import validation

# Upload body = file(s) + multipart framing; anything else is small JSON.
MAX_UPLOAD_BODY_BYTES = validation.MAX_FILE_SIZE_BYTES + 5 * 1024 * 1024
MAX_JSON_BODY_BYTES = 2 * 1024 * 1024

_EXPENSIVE_PREFIXES = ("/chat", "/search/reindex", "/evaluation/", "/decision-eval/run", "/system/disaster-recovery")


def client_ip(request: Request) -> str:
    if config.TRUST_PROXY_HEADERS:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
        real = request.headers.get("x-real-ip")
        if real:
            return real.strip()
    return request.client.host if request.client else "unknown"


class _FixedWindowLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, tuple[int, float]] = {}
        self._last_sweep = time.monotonic()

    def allow(self, key: str, limit: int, window: float = 60.0) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            if now - self._last_sweep > 300:
                self._hits = {k: v for k, v in self._hits.items() if v[1] > now}
                self._last_sweep = now
            count, reset_at = self._hits.get(key, (0, now + window))
            if now >= reset_at:
                count, reset_at = 0, now + window
            if count >= limit:
                return False, max(1, int(reset_at - now))
            self._hits[key] = (count + 1, reset_at)
            return True, 0


limiter = _FixedWindowLimiter()


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        ip = client_ip(request)

        if request.method != "OPTIONS":
            # 1. Body size cap (before anything reads the body)
            declared = request.headers.get("content-length")
            cap = MAX_UPLOAD_BODY_BYTES if path == "/documents/upload" else MAX_JSON_BODY_BYTES
            if declared is not None:
                try:
                    if int(declared) > cap:
                        return JSONResponse({"detail": "Request body too large"}, status_code=413)
                except ValueError:
                    return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
            elif request.method in ("POST", "PUT", "PATCH") and request.headers.get("transfer-encoding"):
                # Chunked bodies have no declared length to check up front.
                return JSONResponse({"detail": "Content-Length required"}, status_code=411)

            # 2. Rate limits
            ok, retry = limiter.allow(f"all:{ip}", config.RATE_LIMIT_PER_MINUTE)
            if ok and path == "/documents/upload":
                ok, retry = limiter.allow(f"upload:{ip}", config.RATE_LIMIT_UPLOADS_PER_MINUTE)
            if ok and path.startswith(_EXPENSIVE_PREFIXES):
                ok, retry = limiter.allow(f"expensive:{ip}", max(10, config.RATE_LIMIT_PER_MINUTE // 4))
            if not ok:
                return JSONResponse(
                    {"detail": "Too many requests"}, status_code=429, headers={"Retry-After": str(retry)}
                )

        response = await call_next(request)

        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if config.IS_PRODUCTION:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if "cache-control" not in h:
            h["Cache-Control"] = "no-store"
        return response
