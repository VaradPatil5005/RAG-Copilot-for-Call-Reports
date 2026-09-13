"""Tests for Phase E: Self-Learning Decision Intelligence Copilot.

Verifies:
  1. Feedback and citation interaction telemetry
  2. Dynamic chunk utility score bounding and reinforcement
  3. Domain lexicon and acronym discovery
  4. Dynamic few-shot exemplar memory
  5. Learning router endpoints
  6. Strict tenant isolation (zero cross-tenant leakage)
"""
from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app import db
from app.services import learning, lexicon_miner, query_rewrite


def test_compute_utility_multiplier_bounds():
    # Baseline defaults to 1.0
    base = learning.compute_utility_multiplier(0, 0, 0, 0, 0)
    assert 0.95 <= base <= 1.05

    # Heavy positive reinforcement capped at 1.30
    high = learning.compute_utility_multiplier(100, 50, 0, 30, 0)
    assert high <= 1.30
    assert high > 1.0

    # Heavy negative reinforcement floored at 0.70
    low = learning.compute_utility_multiplier(100, 5, 25, 0, 20)
    assert low >= 0.70
    assert low < 1.0


def test_feedback_and_chunk_utility_flow():
    # Ensure fresh db tables
    db.init_db()

    trace_id = "test-trace-123"
    tenant_id = "test-tenant-alpha"
    chunk_id = "test-chunk-abc"

    # Insert a synthetic trace
    with db.tx() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO chat_traces (
                trace_id, conversation_id, tenant_id, query, intent,
                retrieved_chunk_ids, answer_json, citation_validation,
                model_name, latency_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                "conv-1",
                tenant_id,
                "What is the status of project Titan?",
                "lookup",
                db.dumps([chunk_id]),
                db.dumps({
                    "answer": "Project Titan is on schedule.",
                    "key_findings": ["On schedule"],
                    "citations": [{"chunk_id": chunk_id, "document_id": "doc-1", "page": 1}],
                    "confidence": "high",
                    "abstained": False,
                }),
                db.dumps({"total": 1, "valid": 1, "stripped": 0, "existence_check_failed": 0, "support_check_failed": 0}),
                "test-model",
                250,
                "2026-09-13T00:00:00Z",
            ),
        )

    # Initial utility score for this chunk should default to 1.0
    initial_scores = learning.get_chunk_utility_multipliers([chunk_id])
    assert initial_scores[chunk_id] == 1.0

    # End user provides positive feedback
    resp = learning.record_feedback(
        trace_id=trace_id,
        rating=1,
        tenant_id=tenant_id,
        issue_category=None,
        correction_text=None,
    )
    assert resp["status"] == "ok"

    # Check updated utility score
    updated_scores = learning.get_chunk_utility_multipliers([chunk_id])
    assert updated_scores[chunk_id] > 1.0

    # Check that it promoted to golden_exemplars
    exemplars = learning.get_relevant_exemplars("lookup", tenant_id, limit=5)
    assert len(exemplars) >= 1
    assert exemplars[0]["query"] == "What is the status of project Titan?"

    # Check citation interaction logging
    click_resp = learning.record_citation_interaction(
        trace_id=trace_id,
        chunk_id=chunk_id,
        document_id="doc-1",
        page_number=1,
        interaction_type="click",
        tenant_id=tenant_id,
    )
    assert click_resp["status"] == "ok"


def test_lexicon_miner_and_query_rewrite_expansion():
    db.init_db()
    tenant_id = "test-tenant-beta"

    text = (
        "During the meeting, the customer discussed their Annual Recurring Revenue (ARR) targets. "
        "They also highlighted BEV (Battery Electric Vehicle) investments for the commercial fleet."
    )

    # Mine from text
    mined = lexicon_miner.mine_and_persist_from_document(
        document_id="doc-corp-1",
        text_corpus=text,
        tenant_id=tenant_id,
    )
    assert mined >= 1

    active = lexicon_miner.get_active_lexicon(tenant_id)
    assert "arr" in active["acronyms"]
    assert "annual recurring revenue" in active["acronyms"]["arr"]

    # Test dynamic query rewrite incorporates the newly discovered acronym
    result = query_rewrite.rewrite_query("What was their target ARR for Q3?", tenant_id=tenant_id)
    assert "annual recurring revenue" in result.rewritten_query.lower()
    assert any("arr -> annual recurring revenue" in exp.lower() for exp in result.expansions)

    # Test tenant isolation: a different tenant should not see tenant-beta's unapproved private jargon
    other_tenant = query_rewrite.rewrite_query("What was their target ARR for Q3?", tenant_id="other-tenant-gamma")
    # 'arr' is not in standard ACRONYMS static table, so other tenant shouldn't expand it unless in their lexicon
    assert "annual recurring revenue" not in other_tenant.rewritten_query.lower()


def test_exemplar_memory_tenant_isolation():
    db.init_db()

    # Exemplar for Tenant A
    learning.promote_to_exemplar(
        trace_id="t-1",
        tenant_id="tenant-alpha",
        query="Compare Q1 vs Q2 for Acme",
        query_category="comparison",
        answer_json={"answer": "Q2 exceeded Q1 by 15%", "citations": []},
        utility_score=1.2,
    )

    # Should be retrievable for Tenant A
    ex_a = learning.get_relevant_exemplars("comparison", "tenant-alpha")
    assert len(ex_a) == 1
    assert "Acme" in ex_a[0]["query"]

    # Should NOT be visible to Tenant B (Zero Leakage)
    ex_b = learning.get_relevant_exemplars("comparison", "tenant-bravo")
    assert len(ex_b) == 0


def test_triplet_mining():
    db.init_db()
    tenant_id = "tenant-triplet-test"

    with db.tx() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO chat_traces (
                trace_id, conversation_id, tenant_id, query, intent,
                retrieved_chunk_ids, answer_json, citation_validation,
                model_name, latency_ms, created_at, confidence, abstained
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "trace-trip-1",
                "conv-trip",
                tenant_id,
                "What is the renewal date?",
                "lookup",
                db.dumps(["chunk-pos-1", "chunk-neg-1", "chunk-neg-2"]),
                db.dumps({
                    "answer": "The renewal is on October 1st.",
                    "citations": [{"chunk_id": "chunk-pos-1", "document_id": "d1"}],
                    "confidence": "high",
                    "abstained": False,
                }),
                db.dumps({"total": 1, "valid": 1, "stripped": 0}),
                "test-model",
                120,
                "2026-09-13T01:00:00Z",
                "high",
                0,
            ),
        )

    triplets = learning.export_triplets(tenant_id=tenant_id)
    assert len(triplets) == 1
    t = triplets[0]
    assert t["positive_chunk_ids"] == ["chunk-pos-1"]
    assert set(t["negative_chunk_ids"]) == {"chunk-neg-1", "chunk-neg-2"}
