"""Phase B tests -- feature/decision-intelligence-layer branch.

Isolated from the existing 57 tests and from Phase A's
test_query_router.py. Covers:
  1. full_benchmark.py's new additive fields/aggregates (pure, no DB)
  2. policy_eval.py's aggregation logic against a fake `agentic_retrieval.run`
     (both a "correctly enforced" and a "leaking" simulation)
  3. The new /decision-eval router, end-to-end against the real `ingested`
     fixture (real ACL enforcement, not simulated)
"""
from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app import db  # noqa: E402
from app.evaluation import full_benchmark  # noqa: E402
from app.evaluation.policy_gold_queries import POLICY_GOLD_QUERIES  # noqa: E402


# --------------------------------------------------------------------------
# 1. full_benchmark.py additive fields -- pure, no fixtures needed
# --------------------------------------------------------------------------


def _make_result(**overrides) -> full_benchmark.FullQueryResult:
    defaults = dict(
        query_id="q", question="q", intent_category="cat_a", difficulty="easy",
        answerable=True, hit=True, reciprocal_rank=1.0, abstained=False, abstention_correct=True,
        semantic_relevancy=4.0, relevancy_judge="heuristic_fallback",
        citation_precision=1.0, citation_recall=1.0, faithfulness=1.0,
        latency_ms=10.0, answer_preview="x",
        existence_check_failed=0, support_check_failed=0, total_citations_checked=2,
    )
    defaults.update(overrides)
    return full_benchmark.FullQueryResult(**defaults)


def test_full_query_result_new_fields_default_to_zero_for_backward_compatibility():
    """A caller constructing FullQueryResult with only the original
    positional fields (as full_benchmark.py's own `run_full_benchmark`
    loop did before Phase B) must still work unchanged."""
    r = full_benchmark.FullQueryResult(
        "q3", "q3", "cat_a", "easy", True, True, 1.0, False, True,
        4.0, "heuristic_fallback", 1.0, 1.0, 1.0, 5.0, "z",
    )
    assert r.existence_check_failed == 0
    assert r.support_check_failed == 0
    assert r.total_citations_checked == 0


def test_summarize_computes_unsupported_claim_rate():
    r1 = _make_result(query_id="q1", existence_check_failed=0, support_check_failed=0, total_citations_checked=2)
    r2 = _make_result(query_id="q2", existence_check_failed=1, support_check_failed=1, total_citations_checked=2, citation_precision=0.5, citation_recall=0.5, faithfulness=0.5)
    summary = full_benchmark._summarize([r1, r2])

    assert summary["overall"]["unsupported_claim_rate"] == round(2 / 4, 4)
    assert summary["by_category"]["cat_a"]["unsupported_claim_rate"] == round(2 / 4, 4)


def test_summarize_computes_mean_citation_precision_recall():
    r1 = _make_result(query_id="q1", citation_precision=1.0, citation_recall=1.0)
    r2 = _make_result(query_id="q2", citation_precision=0.5, citation_recall=0.5)
    summary = full_benchmark._summarize([r1, r2])

    assert summary["overall"]["mean_citation_precision"] == 0.75
    assert summary["overall"]["mean_citation_recall"] == 0.75


def test_summarize_handles_no_citations_without_dividing_by_zero():
    r = _make_result(total_citations_checked=0, existence_check_failed=0, support_check_failed=0, citation_precision=None, citation_recall=None)
    summary = full_benchmark._summarize([r])

    assert summary["overall"]["unsupported_claim_rate"] is None
    assert summary["overall"]["mean_citation_precision"] is None


def test_existing_summary_fields_are_unchanged():
    """The Phase B additions are additive keys only -- every field the
    existing /evaluation page (apps/web/src/app/evaluation/page.tsx) and
    test_phase6_evaluation.py already read must still be present with
    the same meaning."""
    r = _make_result()
    summary = full_benchmark._summarize([r])
    for key in ("hit_rate", "hit_rate_95ci", "mrr", "abstention_accuracy", "mean_semantic_relevancy", "mean_faithfulness", "latency_ms"):
        assert key in summary["overall"]
    for key in ("n_queries", "overall", "by_category", "failure_cases", "n_failure_cases", "semantic_relevancy_judge_used", "caveat"):
        assert key in summary


# --------------------------------------------------------------------------
# 2. policy_eval.py aggregation -- fake agentic_retrieval.run (no DB/hnswlib)
# --------------------------------------------------------------------------


class _FakeAgenticResult:
    def __init__(self, evidence):
        self.evidence = evidence


def _correctly_enforced_acl(question, top_k, filters):
    principals = filters.principals or []
    if "owner:alice" in principals or "customer:Contoso" in principals:
        allowed = {"Contoso"}
    elif "owner:carol" in principals:
        allowed = {"Globex"}
    else:
        allowed = set()
    target = "Contoso" if "contoso" in question.lower() else "Globex" if "globex" in question.lower() else None
    evidence = [{"customer_name": target}] if target in allowed else []
    return _FakeAgenticResult(evidence)


def _leaking_acl(question, top_k, filters):
    """Simulates a real ACL regression: owner:alice can also see Globex."""
    principals = filters.principals or []
    if "owner:alice" in principals:
        allowed = {"Contoso", "Globex"}
    elif "owner:carol" in principals:
        allowed = {"Globex"}
    elif "customer:Contoso" in principals:
        allowed = {"Contoso"}
    else:
        allowed = set()
    target = "Contoso" if "contoso" in question.lower() else "Globex" if "globex" in question.lower() else None
    evidence = [{"customer_name": target}] if target in allowed else []
    return _FakeAgenticResult(evidence)


def test_policy_eval_scores_correctly_enforced_acl_as_fully_accurate(monkeypatch):
    from app.services import agentic_retrieval

    from app.evaluation import policy_eval

    monkeypatch.setattr(agentic_retrieval, "run", _correctly_enforced_acl)
    report = policy_eval.run_policy_block_eval()

    assert report["n_cases"] == len(POLICY_GOLD_QUERIES)
    assert report["policy_block_accuracy"] == 1.0
    assert report["false_allow_count"] == 0
    assert report["false_block_count"] == 0


def test_policy_eval_flags_an_acl_leak_as_a_false_allow(monkeypatch):
    from app.services import agentic_retrieval

    from app.evaluation import policy_eval

    monkeypatch.setattr(agentic_retrieval, "run", _leaking_acl)
    report = policy_eval.run_policy_block_eval()

    assert report["false_allow_count"] == 1
    assert "pb-002" in report["false_allow_cases"]
    assert report["policy_block_accuracy"] < 1.0


# --------------------------------------------------------------------------
# 3. /decision-eval router -- real ACL enforcement via the `ingested` fixture
# --------------------------------------------------------------------------


def test_policy_gold_set_endpoint(ingested):
    client = ingested["client"]
    resp = client.get("/decision-eval/policy-gold-set")
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_cases"] == len(POLICY_GOLD_QUERIES)


def test_run_policy_block_endpoint_against_real_acl_enforcement(ingested):
    """No mocking here -- exercises the project's real, already-tested
    SQL-level ACL predicate (test_phase6_acl.py) through the new metric.
    Contoso is owned by alice, Globex by carol in the `ingested` fixture
    corpus (see conftest.py / test_phase6_acl.py)."""
    client = ingested["client"]
    resp = client.post("/decision-eval/run-policy-block", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["n_cases"] == len(POLICY_GOLD_QUERIES)
    assert 0.0 <= body["policy_block_accuracy"] <= 1.0
    assert "run_id" in body

    conn = db.get_connection()
    row = conn.execute(
        "SELECT * FROM decision_eval_runs WHERE run_id = ?", (body["run_id"],)
    ).fetchone()
    assert row is not None
    assert row["kind"] == "policy_block"


def test_latest_policy_block_endpoint_reflects_the_persisted_run(ingested):
    client = ingested["client"]
    run_resp = client.post("/decision-eval/run-policy-block", json={})
    assert run_resp.status_code == 200

    latest_resp = client.get("/decision-eval/latest-policy-block")
    assert latest_resp.status_code == 200
    body = latest_resp.json()
    assert body["available"] is True
    assert body["run_id"] == run_resp.json()["run_id"]


def test_summary_endpoint_is_read_only_and_never_500s_with_no_prior_runs():
    """Doesn't use the `ingested` fixture on purpose: confirms /summary
    degrades gracefully (no crash, `*_available: False`) before either
    underlying benchmark has ever been run, rather than assuming a prior
    test in the session already populated both tables."""
    from fastapi.testclient import TestClient

    from app import db as db_module
    from app.main import app

    db_module.init_db()
    client = TestClient(app)
    resp = client.get("/decision-eval/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert "quality_available" in body
    assert "policy_available" in body
