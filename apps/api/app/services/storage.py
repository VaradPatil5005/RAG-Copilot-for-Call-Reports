"""Local filesystem storage — substitutes Azure Data Lake Storage Gen2.

Layout mirrors the target ADLS zone structure so the swap later is a config
change:
  data/raw/{tenant_id}/{document_id}/{version}/source.pdf       (immutable)
  data/raw/{tenant_id}/{document_id}/{version}/metadata.json    (immutable,
                                                                  Phase 6.5)
  data/derived/{tenant_id}/{document_id}/{version}/elements.json
  data/derived/{tenant_id}/{document_id}/{version}/manifest.json
  data/derived/{tenant_id}/{document_id}/{version}/figures/{figure_id}.png

The `metadata.json` sidecar exists so disaster recovery
(`services/disaster_recovery.py`) never has to reconstruct security-
relevant fields (`classification`) by guessing or sniffing untrusted
document content -- see that module's docstring for why this file exists
and what gap it closed.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "data"
RAW_ROOT = DATA_ROOT / "raw"
DERIVED_ROOT = DATA_ROOT / "derived"


def raw_dir(tenant_id: str, document_id: str, version: int) -> Path:
    return RAW_ROOT / tenant_id / document_id / str(version)


def derived_dir(tenant_id: str, document_id: str, version: int) -> Path:
    return DERIVED_ROOT / tenant_id / document_id / str(version)


def figures_dir(tenant_id: str, document_id: str, version: int) -> Path:
    d = derived_dir(tenant_id, document_id, version) / "figures"
    d.mkdir(parents=True, exist_ok=True)
    return d


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_raw_pdf(tenant_id: str, document_id: str, version: int, data: bytes) -> str:
    """Immutable write — a version's source PDF is never overwritten."""
    d = raw_dir(tenant_id, document_id, version)
    d.mkdir(parents=True, exist_ok=True)
    path = d / "source.pdf"
    if not path.exists():
        path.write_bytes(data)
    return str(path)


def save_metadata_sidecar(tenant_id: str, document_id: str, version: int, metadata: dict[str, Any]) -> str:
    """Phase 6.5: an immutable copy of upload-time metadata (customer_name,
    account_owner, meeting_date, classification, filename, sha256) written
    into the *raw* zone, alongside `source.pdf` -- not the metadata DB,
    not the derived zone. This is what makes raw storage alone sufficient
    for disaster recovery to restore `classification` correctly (see
    `services/disaster_recovery.py`); the derived zone and the SQLite DB
    are both allowed to be lost in the DR drill's threat model, raw
    storage is the one thing assumed to survive."""
    d = raw_dir(tenant_id, document_id, version)
    d.mkdir(parents=True, exist_ok=True)
    path = d / "metadata.json"
    if not path.exists():  # immutable, same posture as source.pdf
        path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return str(path)


def load_metadata_sidecar(tenant_id: str, document_id: str, version: int) -> dict[str, Any] | None:
    path = raw_dir(tenant_id, document_id, version) / "metadata.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_json(path: Path, content: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return str(path)
