"""System health + monitoring endpoints.

Phase 1-3 scope: liveness + a shallow look at whether the hybrid index has
been provisioned. Phase 5 adds `/system/metrics`: aggregate stats over
`chat_traces` (blueprint Section 4.4 "monitoring-friendly behavior" --
abstention rate, citation validation pass rate, latency percentiles). Real
service health checks (queue depth, Azure OpenAI quota, index replica
health) and a real dashboard (Azure Monitor/App Insights equivalent) remain
Phase 6/8 scope.
"""
from fastapi import APIRouter, Request

from app import db
from app.services import embeddings, generation, search_index

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
def health() -> dict:
    search_status = "not_provisioned"
    try:
        mgr = search_index.get_index_manager()
        search_status = f"up (sqlite-fts5 + hnswlib, {mgr._index.get_current_count()} vectors)"
    except Exception:  # noqa: BLE001
        pass

    generation_provider = generation.get_default_provider()
    generation_status = (
        f"up ({generation_provider.model_name})"
        if not generation.provider_is_fallback()
        else f"up ({generation_provider.model_name}) -- no hosted/local LLM reachable, see ADR 0005"
    )

    return {
        "status": "ok",
        "phase": "5-advanced-reasoning",
        "services": {
            "api": "up",
            "ingestion_pipeline": "up",
            "metadata_store": "up (sqlite)",
            "search_index": search_status,
            "embedding_provider": (
                "fastembed" if not embeddings.provider_is_fallback() else "fallback (fastembed unreachable)"
            ),
            "generation_service": generation_status,
        },
    }


def _percentile(sorted_values: list[float], pct: float) -> float | None:
    if not sorted_values:
        return None
    idx = min(len(sorted_values) - 1, int(round(pct / 100 * (len(sorted_values) - 1))))
    return sorted_values[idx]


@router.post("/disaster-recovery/drill")
def disaster_recovery_drill() -> dict:
    """Phase 6.5: the actual DR drill -- rebuilds the full searchable
    index (metadata rows, elements, chunks, FTS5, hnswlib vectors, graph)
    from nothing but the immutable raw PDF zone. See
    `services/disaster_recovery.py` for the recovery precedence and the
    classification-recoverability gap this phase closed. Idempotent --
    safe to call against a DB that isn't actually empty (recovery uses
    INSERT OR IGNORE, same as normal ingestion)."""
    from app.services import disaster_recovery

    report = disaster_recovery.recover_from_raw_storage()
    return {
        "n_documents_found": report.n_documents_found,
        "n_recovered_via_sidecar": report.n_recovered_via_sidecar,
        "n_recovered_with_defaulted_classification": report.n_recovered_with_defaulted_classification,
        "n_failed": report.n_failed,
        "all_recovered": report.all_recovered,
        "elapsed_seconds": report.elapsed_seconds,
        "documents": [d.__dict__ for d in report.documents],
    }


@router.get("/audit")
def audit_log(limit: int = 100, tenant_id: str | None = None, endpoint: str | None = None) -> dict:
    """Phase 6.3: queryable audit trail -- for any given answer, which
    identity asked, what ACL filter was actually built, and which
    evidence chunk_ids were actually authorized and returned. Read-only;
    surfaced directly in the Admin panel (Phase 6.6)."""
    conn = db.get_connection()
    sql = "SELECT * FROM access_audit_log"
    params: list = []
    clauses = []
    if tenant_id:
        clauses.append("tenant_id = ?")
        params.append(tenant_id)
    if endpoint:
        clauses.append("endpoint = ?")
        params.append(endpoint)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    rows = db.rows_to_list(conn.execute(sql, params).fetchall())
    for r in rows:
        r["principals"] = db.loads(r.get("principals"))
        r["evidence_chunk_ids"] = db.loads(r.get("evidence_chunk_ids"), [])
    return {"entries": rows, "count": len(rows)}


@router.get("/metrics")
def metrics(limit: int = 500) -> dict:
    """Aggregate, monitoring-friendly stats over recent `chat_traces`
    (blueprint Section 4.4): abstention rate, citation-validation pass
    rate, and latency percentiles. Not a replacement for Azure
    Monitor/Application Insights -- this is the local substitute per ADR
    0001, good enough to catch drift (e.g. unsupported-claim rate rising)
    during development."""
    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute(
            "SELECT confidence, abstained, latency_ms, citation_validation, provider_is_fallback, "
            "json_retry_used FROM chat_traces ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    )
    n = len(rows)
    if n == 0:
        return {"n_traces": 0, "message": "No chat_traces recorded yet."}

    abstained = sum(1 for r in rows if r["abstained"])
    fallback_used = sum(1 for r in rows if r["provider_is_fallback"])
    json_retries = sum(1 for r in rows if r["json_retry_used"])

    latencies = sorted(r["latency_ms"] for r in rows if r["latency_ms"] is not None)

    total_citations = 0
    valid_citations = 0
    stripped_citations = 0
    for r in rows:
        cv = db.loads(r.get("citation_validation"), {}) or {}
        total_citations += cv.get("total", 0) or 0
        valid_citations += cv.get("valid", 0) or 0
        stripped_citations += cv.get("stripped", 0) or 0

    return {
        "n_traces": n,
        "abstention_rate": round(abstained / n, 4),
        "fallback_provider_rate": round(fallback_used / n, 4),
        "json_retry_rate": round(json_retries / n, 4),
        "citation_validation_pass_rate": (
            round(valid_citations / total_citations, 4) if total_citations else None
        ),
        "unsupported_claim_rate": (
            round(stripped_citations / total_citations, 4) if total_citations else None
        ),
        "latency_ms": {
            "p50": _percentile(latencies, 50),
            "p95": _percentile(latencies, 95),
            "p99": _percentile(latencies, 99),
        },
    }


# Phase 6.6: cost is reported only for the free-tier configurations this
# project actually documents choosing (ADR 0005) -- $0 here reflects a
# real, stated pricing plan, not a guess. Any other model_name/prefix
# reports estimated_cost_usd=None (unknown) rather than silently
# assuming $0 or inventing a per-token rate this project has no
# authoritative source for.
def _cost_for_model(model_name: str, total_tokens: int) -> tuple[float | None, str]:
    if model_name.startswith("extractive-fallback"):
        return 0.0, "no LLM API call made"
    if model_name.startswith("ollama:"):
        return 0.0, "self-hosted -- no metered API cost (compute cost not modeled)"
    if model_name.startswith("gemini:"):
        return 0.0, "AI Studio free tier assumed per ADR 0005 -- verify your configured model/quota tier"
    if model_name.startswith("groq:"):
        return 0.0, "Groq free tier assumed per ADR 0005 -- verify your configured model/quota tier"
    return None, "unknown pricing -- model not in this project's documented free-tier list"


@router.get("/admin/cost-usage")
def cost_usage(days: int = 30) -> dict:
    """Phase 6.6 Admin panel -- Cost/usage view. Real token counts from
    each provider's own API response (`chat_traces.prompt_tokens` etc.,
    populated in generation.py -- never estimated), grouped by model and
    by day, with a cost figure only where this project has a documented
    basis for one (see `_cost_for_model`)."""
    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute(
            "SELECT model_name, prompt_tokens, completion_tokens, total_tokens, created_at, tenant_id "
            "FROM chat_traces WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC",
            (f"-{days} days",),
        ).fetchall()
    )
    by_model: dict[str, dict] = {}
    by_day: dict[str, int] = {}
    by_tenant: dict[str, int] = {}
    for r in rows:
        model = r["model_name"] or "unknown"
        entry = by_model.setdefault(
            model, {"n_calls": 0, "total_tokens": 0, "estimated_cost_usd": 0.0, "cost_basis": None}
        )
        entry["n_calls"] += 1
        tt = r["total_tokens"] or 0
        entry["total_tokens"] += tt
        cost, basis = _cost_for_model(model, tt)
        entry["cost_basis"] = basis
        if cost is not None and entry["estimated_cost_usd"] is not None:
            entry["estimated_cost_usd"] += cost
        else:
            entry["estimated_cost_usd"] = None

        day = (r["created_at"] or "")[:10]
        by_day[day] = by_day.get(day, 0) + 1
        by_tenant[r["tenant_id"] or "unknown"] = by_tenant.get(r["tenant_id"] or "unknown", 0) + 1

    return {
        "window_days": days,
        "n_queries_total": len(rows),
        "by_model": by_model,
        "query_volume_by_day": dict(sorted(by_day.items())),
        "query_volume_by_tenant": by_tenant,
    }


@router.get("/admin/overview")
def admin_overview(request: Request) -> dict:
    """Phase 6.6: everything the Admin panel needs in one call -- system
    health, index status, ingestion queue depth, recent security events,
    tenant/document access summary, and the latest evaluation report --
    reusing `health()`, `metrics()`, `audit_log()`, and `cost_usage()`
    above rather than a parallel aggregation path. Every number here
    traces to a real persisted record or a live measurement, per the
    Phase 6.6 exit criteria -- nothing here is mock/placeholder data."""
    queue = getattr(request.app.state, "ingestion_queue", None)
    conn = db.get_connection()

    in_progress_statuses = (
        "queued", "validating", "extracting", "multimodal_extraction",
        "normalizing", "chunking", "embedding", "indexing", "graph_extraction",
    )
    placeholders = ",".join("?" for _ in in_progress_statuses)
    persisted_queue_depth = conn.execute(
        f"SELECT COUNT(*) AS n FROM document_versions WHERE status IN ({placeholders})", in_progress_statuses
    ).fetchone()["n"]

    recent_denials = conn.execute(
        "SELECT COUNT(*) AS n FROM access_audit_log WHERE evidence_count = 0 AND principals IS NOT NULL "
        "AND created_at >= datetime('now', '-1 day')"
    ).fetchone()["n"]

    tenant_summary = db.rows_to_list(
        conn.execute(
            "SELECT tenant_id, COUNT(*) AS n_queries, COUNT(DISTINCT identity_sub) AS n_identities "
            "FROM access_audit_log WHERE created_at >= datetime('now', '-7 days') GROUP BY tenant_id"
        ).fetchall()
    )
    document_summary = db.rows_to_list(
        conn.execute(
            "SELECT tenant_id, classification, COUNT(*) AS n_documents FROM documents GROUP BY tenant_id, classification"
        ).fetchall()
    )

    return {
        "health": health(),
        "index_versions": search_index.list_index_versions(),
        "ingestion_queue_depth_live": queue.queue_depth if queue is not None else None,
        "ingestion_queue_depth_persisted": persisted_queue_depth,
        "security": {
            "zero_evidence_responses_last_24h": recent_denials,
            "zero_evidence_responses_caveat": (
                "Includes both real ACL denials and ordinary no-match queries -- "
                "this project doesn't yet distinguish the two in access_audit_log. "
                "See /system/audit for the underlying entries."
            ),
            "tenant_access_summary_7d": tenant_summary,
            "document_access_summary": document_summary,
        },
        "chat_metrics": metrics(),
        "cost_usage": cost_usage(),
        "latest_evaluation_run": db.row_to_dict(
            conn.execute(
                "SELECT run_id, kind, n_queries, created_at FROM evaluation_runs ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
        ),
    }


@router.get("/insights")
def ai_insights(limit: int = 20) -> dict:
    """Synthesizes cross-report intelligence and actionable signals across
    all ingested call reports: active risks, action commitments, and competitor mentions.
    """
    conn = db.get_connection()
    items: list[dict] = []

    # 1. Narrative graph-extracted risks (e.g. Contoso, Globex)
    risk_edges = db.rows_to_list(
        conn.execute(
            """
            SELECT d.document_id, d.filename, d.customer_name, c.content
            FROM graph_edges ge
            JOIN documents d ON d.document_id = ge.source_document_id
            LEFT JOIN chunks c ON c.chunk_id = ge.source_chunk_id
            WHERE ge.predicate = 'HAS_RISK'
            """
        ).fetchall()
    )
    for r in risk_edges:
        content = (r.get("content") or "").strip()
        lines = [
            ln.strip()
            for ln in content.split("\n")
            if ln.strip()
            and not ln.startswith("Document:")
            and not ln.startswith("Section:")
            and not ln.startswith("Page:")
            and not ln.startswith("Risks")
        ]
        desc = " ".join(lines)
        items.append({
            "id": f"risk-{r['document_id']}",
            "type": "risk",
            "category": "Compliance & Operational",
            "severity": "high",
            "title": f"Risk Detected: {r.get('customer_name') or r.get('filename')}",
            "description": desc[:240] if desc else f"Risk signal identified in {r['filename']}.",
            "source_document": r["filename"],
            "document_id": r["document_id"],
            "customer": r.get("customer_name") or "Enterprise Account",
            "owner": "Account Director",
            "due_date": "High Priority",
        })

    # 2. Structured risk tables from domain call reports
    risk_tables = db.rows_to_list(
        conn.execute(
            """
            SELECT d.document_id, d.filename, d.customer_name, c.table_json
            FROM chunks c
            JOIN documents d ON d.document_id = c.document_id
            WHERE c.section_path LIKE '%risk%' AND c.chunk_type = 'table'
            """
        ).fetchall()
    )
    for rt in risk_tables:
        raw_json = rt.get("table_json")
        if not raw_json:
            continue
        try:
            tdata = db.loads(raw_json) or {}
            for row in tdata.get("rows", []):
                if len(row) >= 4 and "risk" in str(row[1]).lower():
                    desc = str(row[2]).replace("\n", " ").strip()
                    owner = str(row[4]).replace("\n", " ").strip() if len(row) > 4 else "Project Team"
                    clean_cust = rt.get("customer_name") or rt["filename"].replace("_Call_Report.pdf", "").replace("_", " ").lstrip("0123456789 ")
                    items.append({
                        "id": f"risk-{rt['document_id']}-{str(row[0])[:8]}",
                        "type": "risk",
                        "category": "Operational Risk",
                        "severity": str(row[3]).lower() if len(row) > 3 else "high",
                        "title": desc[:65] + ("..." if len(desc) > 65 else ""),
                        "description": desc,
                        "source_document": rt["filename"],
                        "document_id": rt["document_id"],
                        "customer": clean_cust,
                        "owner": owner,
                        "due_date": "Active",
                    })
        except Exception:
            continue

    # 3. Action registers across all domain reports
    action_tables = db.rows_to_list(
        conn.execute(
            """
            SELECT d.document_id, d.filename, d.customer_name, c.table_json
            FROM chunks c
            JOIN documents d ON d.document_id = c.document_id
            WHERE c.section_path LIKE '%Action register%' AND c.chunk_type = 'table'
            """
        ).fetchall()
    )
    for at in action_tables:
        raw_json = at.get("table_json")
        if not raw_json:
            continue
        try:
            tdata = db.loads(raw_json) or {}
            for row in tdata.get("rows", []):
                if len(row) >= 3:
                    clean_cust = at.get("customer_name") or at["filename"].replace("_Call_Report.pdf", "").replace("_", " ").lstrip("0123456789 ")
                    status = str(row[3]) if len(row) > 3 else "Open"
                    items.append({
                        "id": f"action-{at['document_id']}-{str(row[0])[:8]}",
                        "type": "action",
                        "category": "Action Item",
                        "severity": "medium",
                        "title": str(row[0]),
                        "description": f"Assigned to {row[1]} with target delivery {row[2]}. Status: {status}",
                        "source_document": at["filename"],
                        "document_id": at["document_id"],
                        "customer": clean_cust,
                        "owner": str(row[1]),
                        "due_date": str(row[2]),
                    })
        except Exception:
            continue

    # 4. Competitor intelligence
    comp_edges = db.rows_to_list(
        conn.execute(
            """
            SELECT d.document_id, d.filename, d.customer_name, ge.object_node_id
            FROM graph_edges ge
            JOIN documents d ON d.document_id = ge.source_document_id
            WHERE ge.predicate = 'MENTIONED_COMPETITOR'
            GROUP BY d.document_id, ge.object_node_id
            """
        ).fetchall()
    )
    for ce in comp_edges:
        comp = ce["object_node_id"].replace("competitor:", "").title()
        items.append({
            "id": f"comp-{ce['document_id']}-{ce['object_node_id']}",
            "type": "market",
            "category": "Competitor Signal",
            "severity": "medium",
            "title": f"Competitive Pressure: {comp}",
            "description": f"Customer evaluation cited {comp} regarding pricing and capabilities comparison.",
            "source_document": ce["filename"],
            "document_id": ce["document_id"],
            "customer": ce.get("customer_name") or "Enterprise Account",
            "owner": "Account Team",
            "due_date": "Ongoing",
        })

    return {
        "n_insights": len(items),
        "insights": items[:limit],
    }
