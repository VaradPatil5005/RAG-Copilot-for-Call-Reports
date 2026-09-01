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

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


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
# for local dev only and `auth.py` refuses to start with it if
# AUTH_DEV_MODE is explicitly turned off.
AUTH_SECRET = get("AUTH_SECRET", "local-dev-insecure-secret-do-not-use-in-production")
AUTH_DEV_MODE = get("AUTH_DEV_MODE", "true").lower() in ("1", "true", "yes")
AUTH_TOKEN_TTL_SECONDS = int(get("AUTH_TOKEN_TTL_SECONDS", "3600"))
