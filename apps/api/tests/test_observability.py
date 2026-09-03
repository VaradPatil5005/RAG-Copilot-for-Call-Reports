"""Phase C tests -- feature/decision-intelligence-layer branch.

Isolated from the existing 57 tests and from Phases A/B's own test files.
Covers:
  1. observability/instrumentation.py's write functions against a real
     (test) DB
  2. observability/dashboard.py's read-side aggregation, seeded directly
     (no need to run a real /chat call for the aggregation logic itself)
  3. The new /observability router, end-to-end via a real /chat call
     through the `ingested` fixture
  4. Confirms the existing SSE stage list and chat_traces schema are
     unchanged by this phase's instrumentation
"""
from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app import db  # noqa: E402
from app.observability import dashboard, instrumentation  # noqa: E402


# --------------------------------------------------------------------------
# 1. instrumentation.py write functions
# --------------------------------------------------------------------------


def test_record_stage_timings_writes_one_row_per_stage(ingested):
    instrumentation.record_stage_timings(
        trace_id="trace-phase-c-timings-1",
        conversation_id="conv-1",
        tenant_id="tenant-a",
        timings=[("understanding_query", 5), ("retrieving_evidence", 120), ("generating", 800)],
    )
    conn = db.get_connection()
    rows = conn.execute(
        "SELECT stage, elapsed_ms FROM chat_trace_stage_timings WHERE trace_id = ? ORDER BY id",
        ("trace-phase-c-timings-1",),
    ).fetchall()
    assert [dict(r)["stage"] for r in rows] == ["understanding_query", "retrieving_evidence", "generating"]
    assert [dict(r)["elapsed_ms"] for r in rows] == [5, 120, 800]


def test_record_stage_timings_is_a_no_op_for_an_empty_list(ingested):
    """Guards against an empty INSERT ... VALUES with no rows."""
    instrumentation.record_stage_timings(
        trace_id="trace-phase-c-empty", conversation_id=None, tenant_id="tenant-a", timings=[]
    )
    conn = db.get_connection()
    count = conn.execute(
        "SELECT COUNT(*) AS n FROM chat_trace_stage_timings WHERE trace_id = ?", ("trace-phase-c-empty",)
    ).fetchone()["n"]
    assert count == 0


def test_record_failure_writes_a_row(ingested):
    instrumentation.record_failure(
        trace_id="trace-phase-c-fail-1",
        conversation_id=None,
        tenant_id="tenant-a",
        stage="generating",
        query="what happened",
        error_message="boom",
    )
    conn = db.get_connection()
    row = conn.execute(
        "SELECT * FROM chat_trace_errors WHERE trace_id = ?", ("trace-phase-c-fail-1",)
    ).fetchone()
    assert row is not None
    assert row["stage"] == "generating"
    assert row["error_message"] == "boom"


# --------------------------------------------------------------------------
# 2. dashboard.py aggregation, seeded directly
# --------------------------------------------------------------------------


def test_stage_latency_breakdown_computes_percentiles_per_stage(ingested):
    instrumentation.record_stage_timings(
        trace_id="trace-phase-c-agg-1", conversation_id=None, tenant_id="tenant-a",
        timings=[("retrieving_evidence", 100), ("generating", 900)],
    )
    instrumentation.record_stage_timings(
        trace_id="trace-phase-c-agg-2", conversation_id=None, tenant_id="tenant-a",
        timings=[("retrieving_evidence", 200), ("generating", 700)],
    )
    breakdown = dashboard.stage_latency_breakdown()
    assert breakdown["n_rows"] >= 4
    assert "retrieving_evidence" in breakdown["by_stage"]
    assert "generating" in breakdown["by_stage"]
    assert breakdown["by_stage"]["retrieving_evidence"]["n"] >= 2


def test_failure_log_returns_most_recent_first(ingested):
    instrumentation.record_failure(
        trace_id="trace-phase-c-fail-older", conversation_id=None, tenant_id="tenant-a",
        stage="retrieving_evidence", query="q1", error_message="first",
    )
    instrumentation.record_failure(
        trace_id="trace-phase-c-fail-newer", conversation_id=None, tenant_id="tenant-a",
        stage="generating", query="q2", error_message="second",
    )
    log = dashboard.failure_log(limit=2)
    assert log["n_failures"] == 2
    assert log["failures"][0]["trace_id"] == "trace-phase-c-fail-newer"


def test_cost_per_query_reuses_system_cost_for_model(ingested):
    """Confirms the reuse (not reimplementation) of
    `routers.system._cost_for_model` -- same pricing logic
    /system/admin/cost-usage already uses in aggregate."""
    from app.routers import system

    conn = db.get_connection()
    conn.execute(
        "INSERT INTO chat_traces (trace_id, conversation_id, tenant_id, query, intent, retrieved_chunk_ids, "
        "answer_json, citation_validation, model_name, provider_is_fallback, json_retry_used, confidence, "
        "abstained, latency_ms, prompt_tokens, completion_tokens, total_tokens, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "trace-phase-c-cost-1", None, "tenant-a", "a test query", "answerable_single_pass", "[]", "{}", "{}",
            "gemini:gemini-1.5-flash", 0, 0, "high", 0, 500, 100, 50, 150, "2026-01-01T00:00:00Z",
        ),
    )
    conn.commit()

    report = dashboard.cost_per_query(limit=5)
    row = next(q for q in report["queries"] if q["trace_id"] == "trace-phase-c-cost-1")
    expected_cost, expected_basis = system._cost_for_model("gemini:gemini-1.5-flash", 150)
    assert row["estimated_cost_usd"] == expected_cost
    assert row["cost_basis"] == expected_basis


# --------------------------------------------------------------------------
# 3. /observability router end-to-end via a real /chat call
# --------------------------------------------------------------------------


def test_chat_call_populates_stage_timings_and_dashboard_reflects_it(ingested):
    import json as _json

    client = ingested["client"]
    events = []
    with client.stream("POST", "/chat", json={"query": "What risks were raised for Contoso?"}) as resp:
        assert resp.status_code == 200, resp.text
        for line in resp.iter_lines():
            if line and line.startswith("data: "):
                events.append(_json.loads(line[len("data: "):]))
    final = next(e for e in events if e["type"] == "final")
    trace_id = final["trace_id"]

    conn = db.get_connection()
    rows = conn.execute(
        "SELECT stage FROM chat_trace_stage_timings WHERE trace_id = ? ORDER BY id", (trace_id,)
    ).fetchall()
    stages = [dict(r)["stage"] for r in rows]
    assert stages == ["understanding_query", "retrieving_evidence", "reasoning", "generating", "validating"]

    resp = client.get("/observability/dashboard")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stage_latency"]["n_rows"] > 0
    assert "chat_metrics" in body
    assert "cost_per_query" in body
    assert "failures" in body


def test_observability_endpoints_exist_and_return_200(ingested):
    client = ingested["client"]
    for path in ("/observability/stage-latency", "/observability/cost-per-query", "/observability/errors"):
        resp = client.get(path)
        assert resp.status_code == 200, f"{path} -> {resp.status_code}: {resp.text}"


# --------------------------------------------------------------------------
# 4. No regression: existing SSE stage list and chat_traces schema unchanged
# --------------------------------------------------------------------------


def test_sse_status_stages_are_unchanged_by_phase_c_instrumentation(ingested):
    """Mirrors test_copilot.py's own
    test_chat_streams_all_required_status_stages assertion -- confirms
    the new `_mark_stage` bookkeeping added nothing to, and removed
    nothing from, the actual SSE status events the frontend depends on."""
    import json as _json

    client = ingested["client"]
    stages = []
    with client.stream("POST", "/chat", json={"query": "What actions were assigned after the Contoso meeting?"}) as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            if line and line.startswith("data: "):
                event = _json.loads(line[len("data: "):])
                if event.get("type") == "status":
                    stages.append(event["stage"])
    assert stages == ["understanding_query", "retrieving_evidence", "reasoning", "generating", "validating"]


def test_chat_traces_schema_still_has_only_its_original_columns(ingested):
    conn = db.get_connection()
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(chat_traces)").fetchall()}
    assert "stage_latency" not in cols
    assert "elapsed_ms" not in cols
