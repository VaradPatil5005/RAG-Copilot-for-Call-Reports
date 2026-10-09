"""Central config loader -- one place to read environment/.env values.

Phase 4 introduces the first real secrets this project has ever needed
(a hosted LLM API key), so this module exists now specifically to avoid
`os.environ[...]` scattered across `generation.py` and friends. Nothing
here is committed -- see `.env.example` for the documented shape and
`.gitignore` for `.env` itself (already covered by the ADR 0001
convention, verified again for Phase 4 in ADR 0005).
"""
from __future__ import annotations

import os
from pathlib import Path

# TATHYX_ENV_FILE lets tests/deployments point at a different file (or none).
_ENV_PATH = Path(os.environ.get("TATHYX_ENV_FILE") or (Path(__file__).resolve().parent.parent / ".env"))


def _load_dotenv(path: Path) -> None:
    """Minimal `.env` loader -- avoids adding python-dotenv as a dependency
    for three lines of parsing. Never overrides a variable already set in
    the real environment (so `export FOO=bar && uvicorn ...` still wins)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(_ENV_PATH)


def get(key: str, default: str | None = None) -> str | None:
    return os.environ.get(key, default)


# --- Generation provider selection -----------------------------------------
# LLM_PROVIDER: "auto" (default) | "gemini" | "groq" | "ollama" | "extractive"
# "auto" tries a hosted provider if its API key is set, then Ollama if
# reachable, then falls back to the deterministic extractive provider --
# see services/generation.py for the full precedence and why the fallback
# exists (same pattern as embeddings.py's HashingEmbeddingProvider).
LLM_PROVIDER = get("LLM_PROVIDER", "auto")

GEMINI_API_KEY = get("GEMINI_API_KEY")
GEMINI_MODEL = get("GEMINI_MODEL", "gemini-2.5-flash")

GROQ_API_KEY = get("GROQ_API_KEY")
GROQ_MODEL = get("GROQ_MODEL", "llama-3.3-70b-versatile")

OLLAMA_BASE_URL = get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = get("OLLAMA_MODEL", "llama3.2")

# --- Auth (Phase 6.3) --------------------------------------------------
# Local-dev substitute for the enterprise IdP (Azure AD/Entra ID in a real
# deployment). AUTH_SECRET signs/verifies JWTs issued by /auth/dev-token --
# a real deployment removes that endpoint entirely and this service only
# ever *verifies* tokens the real IdP issued (swap the verification key
# for the IdP's JWKS). Never commit a real secret; the default below is
# for local dev only and `validate_security_config()` refuses to start
# with it unless AUTH_DEV_MODE is explicitly turned on.
INSECURE_DEFAULT_SECRET = "local-dev-insecure-secret-do-not-use-in-production"
AUTH_SECRET = get("AUTH_SECRET", INSECURE_DEFAULT_SECRET)
# Secure by default: `/auth/dev-token` (which mints a token for *any*
# tenant/principal set) is OFF unless a developer explicitly opts in.
AUTH_DEV_MODE = (get("AUTH_DEV_MODE", "false") or "false").lower() in ("1", "true", "yes")
AUTH_TOKEN_TTL_SECONDS = int(get("AUTH_TOKEN_TTL_SECONDS", "900"))
# Every API token must carry this audience -- the web app's minting code
# (apps/web/src/lib/auth-token.ts) sets the same value.
AUTH_AUDIENCE = get("AUTH_AUDIENCE", "tathyx-api")

# --- Deployment hardening ---------------------------------------------
APP_ENV = (get("APP_ENV", "development") or "development").lower()
IS_PRODUCTION = APP_ENV == "production"
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in (get("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:4500") or "").split(",")
    if o.strip()
]
# Per-client-IP request budget for the in-process rate limiter (main.py).
RATE_LIMIT_PER_MINUTE = int(get("RATE_LIMIT_PER_MINUTE", "120"))
RATE_LIMIT_UPLOADS_PER_MINUTE = int(get("RATE_LIMIT_UPLOADS_PER_MINUTE", "10"))
# Only trust X-Forwarded-For when the API sits behind a known reverse proxy.
TRUST_PROXY_HEADERS = (get("TRUST_PROXY_HEADERS", "false") or "false").lower() in ("1", "true", "yes")

# --- Storage location -------------------------------------------------
# Raw files, derived files, the SQLite DB and the vector index all live
# under this directory. Overridable so the test suite can run against a
# throwaway directory instead of wiping a developer's real data.
DATA_DIR = Path(get("TATHYX_DATA_DIR") or (Path(__file__).resolve().parent.parent / "data")).resolve()


def validate_security_config() -> None:
    """Fail closed at startup instead of silently running insecurely."""
    if AUTH_DEV_MODE and IS_PRODUCTION:
        raise RuntimeError("AUTH_DEV_MODE=true is not allowed when APP_ENV=production")
    if not AUTH_DEV_MODE:
        if AUTH_SECRET == INSECURE_DEFAULT_SECRET:
            raise RuntimeError(
                "AUTH_SECRET is unset or still the insecure default. Generate one with "
                "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"` and set it "
                "identically in apps/api/.env and apps/web/.env.local."
            )
        if len(AUTH_SECRET or "") < 32:
            raise RuntimeError("AUTH_SECRET must be at least 32 characters")
