"""Phase A tests -- feature/decision-intelligence-layer branch.

Isolated from the existing 57 tests: exercises only the new
`app/routing/query_router.py` module and its additive integration point
in `routers/copilot.py`. Does not modify, and is not modified by, any
existing test file.

Sections:
  1. Pure heuristic classification (no DB, no network, no fixtures)
  2. LLM-fallback path on ambiguous queries (fake provider, matches the
     existing `FlakyProvider`-style pattern in test_copilot.py)
  3. Persistence to the new `query_router_decisions` table
  4. End-to-end: the additive integration inside `/chat` (reuses the
     session-scoped `ingested` fixture already built for Phase 3/4/6)
"""
from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app import db  # noqa: E402
from app.routing import query_router  # noqa: E402


# --------------------------------------------------------------------------
# 1. Pure heuristic classification
# --------------------------------------------------------------------------


def test_classifies_comparison_query():
    decision = query_router.classify_query("Compare Contoso's pricing versus Globex's pricing.")
    assert decision.category == "comparison"
    assert decision.method == "heuristic"


def test_classifies_trend_query():
    decision = query_router.classify_query("What is the trend in Contoso's pipeline value over time?")
    assert decision.category == "trend"
    assert decision.method == "heuristic"


def test_classifies_graph_relationship_query():
    decision = query_router.classify_query("Which accounts are linked to Acme Corp as a shared risk?")
    assert decision.category == "graph_relationship"
    assert decision.method == "heuristic"


def test_classifies_multi_hop_query():
    decision = query_router.classify_query(
        "Find the account owner for Contoso and then tell me what risks Bob flagged for them?"
    )
    assert decision.category == "multi_hop"


def test_classifies_lookup_query():
    decision = query_router.classify_query("What was the pipeline value for Contoso?")
    assert decision.category == "lookup"
    assert decision.method == "heuristic"


def test_suggested_paths_are_all_existing_retrieval_paths():
    # Every suggested path name must map to something that already exists
    # in this repo -- the router never invents a new retrieval mechanism.
    existing_paths = {"hybrid_search", "agentic_multi_pass", "temporal_analysis", "graph_store"}
    for category in query_router.CATEGORIES:
        decision = query_router.QueryRouteDecision(
            category=category, method="heuristic", confidence="high",
            suggested_paths=query_router._SUGGESTED_PATHS[category],
        )
        assert set(decision.suggested_paths) <= existing_paths


# --------------------------------------------------------------------------
# 2. LLM fallback on ambiguous queries -- reachability-gated
# --------------------------------------------------------------------------


class _FakeClassifierProvider:
    """Mirrors the `FlakyProvider`/`AlwaysBrokenProvider` pattern already
    used in test_copilot.py: a minimal object satisfying the same
    `LLMProvider` protocol shape, injected explicitly rather than via
    global state."""

    def __init__(self, response_text: str) -> None:
        self._response_text = response_text
        self.calls = 0

    @property
    def model_name(self) -> str:
        return "fake-router-classifier"

    def generate(self, system_prompt, user_prompt, *, stream=False, max_tokens=800):
        self.calls += 1
        return self._response_text


def test_ambiguous_query_uses_llm_fallback_when_reachable(monkeypatch):
    from app.services import generation

    monkeypatch.setattr(generation, "provider_is_fallback", lambda: False)
    fake = _FakeClassifierProvider('{"category": "trend", "confidence": "high"}')

    # A genuinely ambiguous query: no comparator/trend/graph/lookup terms,
    # no multi-hop signal -- every heuristic score is 0.
    decision = query_router.classify_query("Tell me something interesting.", provider=fake)

    assert fake.calls == 1
    assert decision.category == "trend"
    assert decision.method == "llm_fallback"
    assert decision.confidence == "high"


def test_ambiguous_query_falls_back_to_heuristic_default_when_no_llm_reachable(monkeypatch):
    from app.services import generation

    monkeypatch.setattr(generation, "provider_is_fallback", lambda: True)
    decision = query_router.classify_query("Tell me something interesting.")

    assert decision.category == "lookup"
    assert decision.method == "heuristic_default"
    assert decision.confidence == "low"


def test_llm_fallback_with_unparseable_response_still_falls_back_safely(monkeypatch):
    from app.services import generation

    monkeypatch.setattr(generation, "provider_is_fallback", lambda: False)
    fake = _FakeClassifierProvider("not json at all")

    decision = query_router.classify_query("Tell me something interesting.", provider=fake)

    assert decision.category == "lookup"
    assert decision.method == "heuristic_default"


# --------------------------------------------------------------------------
# 3. Persistence -- new, additive table (does not touch chat_traces)
# --------------------------------------------------------------------------


def test_persist_decision_writes_a_retrievable_row(ingested):
    decision = query_router.QueryRouteDecision(
        category="comparison",
        method="heuristic",
        confidence="high",
        signals={"scores": {"comparison": 2}},
        suggested_paths=("hybrid_search", "agentic_multi_pass"),
    )
    query_router.persist_decision(
        trace_id="trace-test-phase-a-0001",
        conversation_id="conv-test-1",
        tenant_id="tenant-a",
        query="Compare X versus Y",
        decision=decision,
    )

    conn = db.get_connection()
    row = conn.execute(
        "SELECT * FROM query_router_decisions WHERE trace_id = ?",
        ("trace-test-phase-a-0001",),
    ).fetchone()
    assert row is not None
    assert row["category"] == "comparison"
    assert row["method"] == "heuristic"
    assert row["confidence"] == "high"
    assert db.loads(row["suggested_paths"]) == ["hybrid_search", "agentic_multi_pass"]


def test_chat_traces_table_is_untouched_by_new_table(ingested):
    """Confirms the additive table lives alongside, not inside,
    chat_traces -- chat_traces' existing columns are unaffected."""
    conn = db.get_connection()
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(chat_traces)").fetchall()}
    # Every column the Phase 4/6 code already relies on must still exist,
    # unchanged, with no new query-router column injected into this table.
    assert {"trace_id", "intent", "query", "answer_json", "citation_validation"} <= cols
    assert "category" not in cols
    assert "query_router_category" not in cols


# --------------------------------------------------------------------------
# 4. End-to-end via /chat -- additive integration, no regression
# --------------------------------------------------------------------------


def test_chat_reasoning_event_includes_query_router_metadata(ingested):
    import json as _json

    client = ingested["client"]
    events = []
    with client.stream(
        "POST", "/chat", json={"query": "Compare Contoso's pricing versus Globex's pricing."}
    ) as resp:
        assert resp.status_code == 200, resp.text
        for line in resp.iter_lines():
            if line and line.startswith("data: "):
                events.append(_json.loads(line[len("data: "):]))

    reasoning = next(e for e in events if e.get("stage") == "reasoning")
    assert "query_router" in reasoning["detail"]
    assert reasoning["detail"]["query_router"]["category"] == "comparison"

    final = next(e for e in events if e["type"] == "final")
    assert final["query_router"]["category"] == "comparison"

    conn = db.get_connection()
    row = conn.execute(
        "SELECT * FROM query_router_decisions WHERE trace_id = ?", (final["trace_id"],)
    ).fetchone()
    assert row is not None
    assert row["category"] == "comparison"


def test_router_additively_merges_graph_evidence_without_bypassing_existing_intent(ingested):
    """A query phrased so the *existing* `classify_intent` heuristic does
    NOT route it to GraphRAG (it uses none of copilot.py's own
    `_GRAPH_HINTS` phrases), but the new router's independent
    `graph_relationship` heuristic does fire on a different phrase
    ("linked to"). Confirms the router only ever ADDS evidence -- the
    existing intent classification for this query is unchanged."""
    from app.routers import copilot as copilot_router

    query = "Which accounts are linked to Acme Corp as a shared risk?"
    # Sanity-check against the *existing*, untouched classifier first --
    # this must keep returning exactly what it always has.
    assert copilot_router.classify_intent(query) == "answerable_single_pass"

    import json as _json

    client = ingested["client"]
    events = []
    with client.stream("POST", "/chat", json={"query": query}) as resp:
        assert resp.status_code == 200, resp.text
        for line in resp.iter_lines():
            if line and line.startswith("data: "):
                events.append(_json.loads(line[len("data: "):]))

    reasoning = next(e for e in events if e.get("stage") == "reasoning")
    assert reasoning["detail"]["intent"] == "answerable_single_pass"
    assert reasoning["detail"]["query_router"]["category"] == "graph_relationship"
    # The additive merge should have contributed at least the shared-
    # Acme-Corp graph evidence already proven to exist by
    # test_phase6_graph.py's test_cross_document_graph_query_returns_multiple_customers.
    assert reasoning["detail"]["graph_evidence_count"] > 0

    final = next(e for e in events if e["type"] == "final")
    assert final["intent"] == "answerable_single_pass"
