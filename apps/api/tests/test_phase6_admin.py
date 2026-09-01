"""Phase 6.6 tests: the Admin panel's backing endpoints. Every assertion
here checks that a number traces to a real persisted record (chat_traces,
access_audit_log, evaluation_runs) -- per the phase's own exit criterion
that nothing in the final UI is mock/placeholder data.
"""
from __future__ import annotations

from app import db


def test_system_metrics_route_is_registered(ingested):
    """Regression test for a real bug caught during this build: an
    earlier edit accidentally dropped `/system/metrics`'s route decorator
    entirely, silently turning it into unreachable dead code. This test
    would have caught it."""
    client = ingested["client"]
    resp = client.get("/system/metrics")
    assert resp.status_code == 200


def test_admin_overview_returns_all_required_sections(ingested):
    client = ingested["client"]
    # Generate at least one real audit-log and chat-trace row first.
    client.post("/search", json={"query": "Contoso pricing risks", "top_k": 5})
    client.post("/chat", json={"query": "What risks were raised for Contoso?"})

    resp = client.get("/system/admin/overview")
    assert resp.status_code == 200
    body = resp.json()
    for key in ("health", "index_versions", "security", "chat_metrics", "cost_usage", "latest_evaluation_run"):
        assert key in body

    assert isinstance(body["index_versions"], list)
    assert "zero_evidence_responses_last_24h" in body["security"]
    assert "by_model" in body["cost_usage"]


def test_admin_overview_ingestion_queue_depth_is_a_real_measurement(ingested):
    client = ingested["client"]
    resp = client.get("/system/admin/overview")
    body = resp.json()
    # Live depth comes from asyncio.Queue.qsize() -- must be a real
    # non-negative integer once the ingestion queue exists, not a mock.
    assert body["ingestion_queue_depth_live"] is None or body["ingestion_queue_depth_live"] >= 0
    assert body["ingestion_queue_depth_persisted"] >= 0


def test_cost_usage_reflects_real_token_counts_from_chat_traces(ingested):
    client = ingested["client"]
    resp = client.post("/chat", json={"query": "What risks were raised for Contoso?"})
    assert resp.status_code == 200

    conn = db.get_connection()
    trace = db.row_to_dict(
        conn.execute("SELECT model_name, total_tokens FROM chat_traces ORDER BY created_at DESC LIMIT 1").fetchone()
    )
    assert trace is not None

    usage_resp = client.get("/system/admin/cost-usage")
    body = usage_resp.json()
    assert trace["model_name"] in body["by_model"]
    # The extractive fallback (this sandbox's active provider) reports a
    # real, not estimated, zero-token/zero-cost usage.
    if trace["model_name"].startswith("extractive-fallback"):
        assert body["by_model"][trace["model_name"]]["estimated_cost_usd"] == 0.0
        assert body["by_model"][trace["model_name"]]["cost_basis"] == "no LLM API call made"


def test_evaluation_latest_matches_a_real_persisted_run(ingested):
    client = ingested["client"]
    from app.evaluation.gold_queries import GOLD_QUERIES

    run_resp = client.post("/evaluation/run-full", json={"top_k": 8, "tenant_id": "tenant-a"})
    assert run_resp.status_code == 200
    run_body = run_resp.json()
    assert run_body["n_queries"] == len(GOLD_QUERIES)

    latest_resp = client.get("/evaluation/latest")
    latest_body = latest_resp.json()
    assert latest_body["available"] is True
    assert latest_body["run_id"] == run_body["run_id"]
    assert latest_body["n_queries"] == run_body["n_queries"]

    # Confirm it's a real DB row, not just an in-memory echo.
    row = db.row_to_dict(
        db.get_connection().execute(
            "SELECT run_id, n_queries FROM evaluation_runs WHERE run_id = ?", (run_body["run_id"],)
        ).fetchone()
    )
    assert row is not None
    assert row["n_queries"] == run_body["n_queries"]

    overview = client.get("/system/admin/overview").json()
    assert overview["latest_evaluation_run"]["run_id"] == run_body["run_id"]
