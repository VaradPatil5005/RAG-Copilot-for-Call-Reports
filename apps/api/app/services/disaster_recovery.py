"""Disaster recovery (Phase 6.5): rebuild the full searchable index --
metadata DB rows, elements, chunks, FTS5, hnswlib vector index, and the
GraphRAG graph -- from nothing but the immutable raw PDF zone
(`data/raw/**/source.pdf`) plus each document's metadata sidecar. This is
the blueprint's own DR requirement: "from immutable raw storage +
processing manifests, can the full search index be rebuilt from scratch?"

Real finding surfaced while building this drill (before ever running it,
which is itself a legitimate way to catch a design gap -- tracing the
actual recovery path through the code found this, not a hypothetical):
`classification` is a security-relevant field that this project's
`metadata_sniff.py` deliberately never reads from untrusted document
content (correctly -- see that module's docstring). Before this phase,
`classification` was recorded *only* in the SQLite metadata DB, so a
metadata-DB-only disaster made it unrecoverable from raw storage alone,
and a naive recovery defaulting to "internal" or "public" would silently
under-protect a document that was actually "confidential".

Fixed as part of this phase, not just documented as a gap: every upload
now also writes an immutable `metadata.json` sidecar (customer_name,
account_owner, meeting_date, classification, sha256, filename) next to
`source.pdf` (see `services/storage.py` and `routers/documents.py`). This
module's recovery precedence, most-trusted first:

  1. The metadata.json sidecar, when present.
  2. `pipeline.process_document`'s own existing content-based
     auto-detection (`metadata_sniff.sniff_metadata`) for customer_name /
     account_owner / meeting_date -- this already runs on every document
     regardless of whether it's a fresh upload or a recovery, since it
     only fills fields left blank. It never touches classification.
  3. A hard-coded, fail-closed default for classification alone:
     "confidential" (the most restrictive non-public tier) when no
     sidecar exists -- never "public" or "internal". An availability bug
     (over-restricting a document that was actually meant to be public)
     is recoverable by a human reviewing the drill report; a leaked
     confidential document is not.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app import db
from app.services import pipeline, storage

logger = logging.getLogger("disaster_recovery")

_RAW_PATH_RE = re.compile(r"^(?P<tenant_id>[^/]+)/(?P<document_id>[^/]+)/(?P<version>\d+)/source\.pdf$")

FAIL_CLOSED_CLASSIFICATION = "confidential"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RecoveredDocument:
    tenant_id: str
    document_id: str
    version: int
    metadata_source: str  # 'sidecar' | 'defaulted_fail_closed'
    customer_name: str | None = None
    account_owner: str | None = None
    meeting_date: str | None = None
    classification: str | None = None
    status: str = "pending"  # 'recovered' | 'failed'
    error: str | None = None


@dataclass
class RecoveryReport:
    n_documents_found: int = 0
    n_recovered_via_sidecar: int = 0
    n_recovered_with_defaulted_classification: int = 0
    n_failed: int = 0
    elapsed_seconds: float = 0.0
    documents: list[RecoveredDocument] = field(default_factory=list)

    @property
    def all_recovered(self) -> bool:
        return self.n_failed == 0 and self.n_documents_found > 0


def _discover_raw_pdfs(raw_root: Path) -> list[tuple[str, str, int, Path]]:
    """(tenant_id, document_id, version, path) for every source.pdf under
    the raw zone, parsed from the immutable directory structure itself --
    `storage.py`'s layout convention IS the recovery index when the
    metadata DB is gone."""
    out = []
    if not raw_root.exists():
        return out
    for path in raw_root.glob("*/*/*/source.pdf"):
        rel = path.relative_to(raw_root).as_posix()
        m = _RAW_PATH_RE.match(rel)
        if not m:
            continue
        out.append((m["tenant_id"], m["document_id"], int(m["version"]), path))
    return out


def recover_from_raw_storage(raw_root: Path | None = None) -> RecoveryReport:
    """The actual DR drill: bootstraps minimal `documents`/
    `document_versions` rows from raw storage + sidecars, then replays
    the real ingestion pipeline (`pipeline.process_document`) for each --
    the exact same extraction/chunking/embedding/indexing/graph-extraction
    code path production uploads use, not a special-cased recovery path.
    Safe to call against a DB that already has some of these documents
    (`INSERT OR IGNORE` -- recovery is idempotent, same as normal
    ingestion)."""
    start = time.monotonic()
    raw_root = raw_root or storage.RAW_ROOT
    found = _discover_raw_pdfs(raw_root)
    report = RecoveryReport(n_documents_found=len(found))

    for tenant_id, document_id, version, path in found:
        sidecar = storage.load_metadata_sidecar(tenant_id, document_id, version)
        if sidecar:
            recovered = RecoveredDocument(
                tenant_id=tenant_id,
                document_id=document_id,
                version=version,
                metadata_source="sidecar",
                customer_name=sidecar.get("customer_name"),
                account_owner=sidecar.get("account_owner"),
                meeting_date=sidecar.get("meeting_date"),
                classification=sidecar.get("classification") or FAIL_CLOSED_CLASSIFICATION,
            )
        else:
            recovered = RecoveredDocument(
                tenant_id=tenant_id,
                document_id=document_id,
                version=version,
                metadata_source="defaulted_fail_closed",
                classification=FAIL_CLOSED_CLASSIFICATION,
            )

        try:
            now = _now()
            data = path.read_bytes()
            with db.tx() as conn:
                conn.execute(
                    "INSERT OR IGNORE INTO documents (document_id, tenant_id, filename, customer_name, "
                    "account_owner, meeting_date, classification, current_version, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        document_id, tenant_id, path.name, recovered.customer_name,
                        recovered.account_owner, recovered.meeting_date, recovered.classification,
                        version, now,
                    ),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO document_versions (document_id, version, sha256, status, stage, "
                    "file_path, size_bytes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        document_id, version, storage.sha256_bytes(data), "queued", "queued",
                        str(path), len(data), now, now,
                    ),
                )
            pipeline.log_event(document_id, version, "disaster_recovery", "metadata_recovered", f"source={recovered.metadata_source}")

            # Replays the real pipeline -- extraction, multimodal routing,
            # normalization, chunking (with its own content-based
            # customer/owner/date auto-detection for anything still
            # blank), embedding, indexing, and graph extraction.
            pipeline.process_document(document_id, version)

            final = db.row_to_dict(
                db.get_connection().execute(
                    "SELECT customer_name, account_owner, meeting_date FROM documents WHERE document_id = ?",
                    (document_id,),
                ).fetchone()
            )
            if final:
                recovered.customer_name = final.get("customer_name") or recovered.customer_name
                recovered.account_owner = final.get("account_owner") or recovered.account_owner
                recovered.meeting_date = final.get("meeting_date") or recovered.meeting_date
            recovered.status = "recovered"
        except Exception as exc:  # noqa: BLE001
            logger.exception("DR: failed to recover %s v%d", document_id, version)
            recovered.status = "failed"
            recovered.error = str(exc)
            report.n_failed += 1

        if recovered.metadata_source == "sidecar":
            report.n_recovered_via_sidecar += 1
        else:
            report.n_recovered_with_defaulted_classification += 1
        report.documents.append(recovered)

    report.elapsed_seconds = round(time.monotonic() - start, 2)
    return report
