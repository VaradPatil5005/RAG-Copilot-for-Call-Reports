"""Structured access audit logging (Phase 6.3).

Every retrieval-touching request (/search, /retrieval, /chat, /graph/query)
calls `record()` once it knows what evidence it actually returned. This
answers, for any given request, the question the blueprint's Section 9
requires an enterprise deployment be able to answer: which identity asked,
what ACL filter was actually built from that identity, and which evidence
chunk_ids were actually authorized and returned. Persisted in
`access_audit_log`, independent of (and in addition to) `chat_traces`,
which already captures the richer Copilot-specific generation trace.

Never raises into the caller -- an audit-logging failure must not fail a
real user request, same posture as `graph_extraction`/`multimodal_extraction`
being non-fatal ingestion stages.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app import db
from app.services import auth, pii, search_index

logger = logging.getLogger("audit")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def filter_summary(filters: search_index.SearchFilters) -> str:
    parts = [f"tenant={filters.tenant_id}"]
    if filters.principals is not None:
        parts.append(f"principals={filters.principals}")
    else:
        parts.append("principals=UNSCOPED(internal-caller)")
    if filters.customer:
        parts.append(f"customer={filters.customer}")
    if filters.document_id:
        parts.append(f"document_id={filters.document_id}")
    if filters.date_from or filters.date_to:
        parts.append(f"date=[{filters.date_from or ''}..{filters.date_to or ''}]")
    return " ".join(parts)


def record(
    *,
    endpoint: str,
    identity: auth.Identity | None,
    filters: search_index.SearchFilters,
    query: str | None,
    evidence_chunk_ids: list[str],
    trace_id: str | None = None,
) -> None:
    try:
        with db.tx() as conn:
            conn.execute(
                "INSERT INTO access_audit_log (trace_id, endpoint, identity_sub, tenant_id, principals, "
                "acl_filter_summary, query, evidence_chunk_ids, evidence_count, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    trace_id,
                    endpoint,
                    identity.sub if identity else None,
                    filters.tenant_id,
                    db.dumps(filters.principals) if filters.principals is not None else None,
                    filter_summary(filters),
                    pii.redact_for_logging(query),  # Phase 6.5: never persist raw PII in audit logs
                    db.dumps(evidence_chunk_ids),
                    len(evidence_chunk_ids),
                    _now(),
                ),
            )
    except Exception:  # noqa: BLE001
        logger.exception("failed to persist access audit log for endpoint=%s (non-fatal)", endpoint)
