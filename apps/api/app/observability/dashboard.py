"""Observability dashboard -- read side (Phase C, net-new).

Combines three genuinely new views (this project has never had any of
these three before Phase C) with the existing `/system/metrics` aggregate
(reused by calling it directly, not reimplemented):

  1. retrieval-stage latency breakdown  -- NEW (chat_trace_stage_timings)
  2. cost estimate per query            -- NEW, individual-row view; reuses
                                            `routers.system._cost_for_model`,
                                            the same pricing logic
                                            `/system/admin/cost-usage`
                                            already uses in aggregate, so
                                            per-query and aggregate cost
                                            numbers can never drift apart
  3. failure/error log                  -- NEW (chat_trace_errors)
  4. fallback-provider rate /
     JSON-retry rate / abstention rate / -- ALREADY EXISTS: `system.metrics()`
     citation-validation pass rate /        (Phase 6.6). Called directly,
     latency percentiles                    not reimplemented, not
                                             duplicated.
"""
from __future__ import annotations

from app import db
from app.evaluation import quality_metrics


def stage_latency_breakdown(limit: int = 2000) -> dict:
    """Per-stage p50/p95/p99 + call count over the most recent stage-
    timing rows (each /chat call writes one row per stage -- see
    `observability/instrumentation.py`)."""
    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute(
            "SELECT stage, elapsed_ms FROM chat_trace_stage_timings ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    )
    if not rows:
        return {"n_rows": 0, "by_stage": {}, "message": "No stage timings recorded yet."}

    by_stage: dict[str, list[float]] = {}
    for r in rows:
        by_stage.setdefault(r["stage"], []).append(float(r["elapsed_ms"]))

    return {
        "n_rows": len(rows),
        "by_stage": {
            stage: {"n": len(values), **quality_metrics.percentiles(values), "mean_ms": round(sum(values) / len(values), 1)}
            for stage, values in by_stage.items()
        },
    }


def cost_per_query(limit: int = 50) -> dict:
    """Per-query (not aggregated) cost estimate for the most recent
    `chat_traces` rows -- reuses `routers.system._cost_for_model`, the
    same pricing logic `/system/admin/cost-usage` already uses in
    aggregate, so this view and that one can never report inconsistent
    numbers for the same model."""
    from app.routers.system import _cost_for_model  # local import: avoid a routers<->routers import at module load

    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute(
            "SELECT trace_id, query, model_name, total_tokens, tenant_id, created_at "
            "FROM chat_traces ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    )
    entries = []
    for r in rows:
        model = r["model_name"] or "unknown"
        total_tokens = r["total_tokens"] or 0
        cost, basis = _cost_for_model(model, total_tokens)
        entries.append(
            {
                "trace_id": r["trace_id"],
                "query_preview": (r["query"] or "")[:120],
                "model_name": model,
                "total_tokens": total_tokens,
                "estimated_cost_usd": cost,
                "cost_basis": basis,
                "tenant_id": r["tenant_id"],
                "created_at": r["created_at"],
            }
        )
    return {"n_queries": len(entries), "queries": entries}


def failure_log(limit: int = 100) -> dict:
    """The persisted failure/error log -- did not exist before Phase C
    (a failed /chat call previously produced only an SSE error event to
    the one client watching that stream, nothing queryable afterward)."""
    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute(
            "SELECT * FROM chat_trace_errors ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    )
    return {"n_failures": len(rows), "failures": rows}


def dashboard(stage_limit: int = 2000, cost_limit: int = 50, failure_limit: int = 100, metrics_limit: int = 500) -> dict:
    """Everything the new Observability page needs in one call -- mirrors
    `/system/admin/overview`'s own pattern of reusing existing pieces
    rather than a parallel aggregation path."""
    from app.routers import system

    return {
        # Reused, not reimplemented -- see module docstring point 4.
        "chat_metrics": system.metrics(limit=metrics_limit),
        # Net-new below.
        "stage_latency": stage_latency_breakdown(limit=stage_limit),
        "cost_per_query": cost_per_query(limit=cost_limit),
        "failures": failure_log(limit=failure_limit),
    }
