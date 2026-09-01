"""Gold evaluation query set (blueprint Section 7 / 13).

Stratified by intent category per the blueprint's recommended proportions.
Scoped to the project's synthetic Contoso/Globex sample corpus (see
apps/api/tests/conftest.py) so it runs end-to-end without a real 100K-
document corpus. This is a *framework* seed, not the full 300+ query
benchmark the blueprint specifies for production sign-off --
docs/decisions/0006-phase5-advanced-reasoning.md is explicit that reaching
300+ needs a real document corpus and SME annotation this project doesn't
have yet. Extend this list category-by-category as real documents land.

Queries are keyed by `gold_customers` (not `gold_document_ids`) because
document IDs are generated per-ingest (see conftest.py) and aren't stable
across runs -- customer_name is the stable join key available on every
retrieved chunk.

Each entry:
  query_id, question, intent_category, answerable,
  gold_customers    (customer_name values that should appear among the
                      retrieved evidence's chunks -- proxy for Recall@k
                      without needing hand-labeled chunk_ids per reload)
  required_terms    (terms that should appear somewhere in the retrieved
                      evidence content -- proxy for "the right passage was
                      found")
"""
from __future__ import annotations

GOLD_QUERIES: list[dict] = [
    {
        "query_id": "q-001",
        "question": "What risks were raised in the Contoso account review?",
        "intent_category": "single_document_fact",
        "answerable": True,
        "gold_customers": ["Contoso"],
        "required_terms": ["risk"],
    },
    {
        "query_id": "q-002",
        "question": "What actions were assigned after the Contoso meeting?",
        "intent_category": "single_document_fact",
        "answerable": True,
        "gold_customers": ["Contoso"],
        "required_terms": ["action"],
    },
    {
        "query_id": "q-003",
        "question": "Which customers mentioned Acme Corp as a competitor?",
        "intent_category": "multi_document_synthesis",
        "answerable": True,
        "gold_customers": ["Contoso", "Globex"],
        "required_terms": ["acme"],
    },
    {
        "query_id": "q-004",
        "question": "What is the current pricing status for Contoso?",
        "intent_category": "temporal_status",
        "answerable": True,
        "gold_customers": ["Contoso"],
        "required_terms": ["pricing"],
    },
    {
        "query_id": "q-005",
        "question": "Has the customer approved the proposal?",
        "intent_category": "temporal_status",
        "answerable": True,
        "gold_customers": ["Contoso"],
        "required_terms": ["approv"],
    },
    {
        "query_id": "q-006",
        "question": "What pipeline value was discussed for Contoso?",
        "intent_category": "table_lookup",
        "answerable": True,
        "gold_customers": ["Contoso"],
        "required_terms": ["pipeline"],
    },
    {
        "query_id": "q-007",
        "question": "Compare the open actions between Contoso and Globex.",
        "intent_category": "entity_comparison",
        "answerable": True,
        "gold_customers": ["Contoso", "Globex"],
        "required_terms": ["action"],
    },
    {
        "query_id": "q-008",
        "question": "What was Contoso's total annual revenue last year?",
        "intent_category": "unanswerable",
        "answerable": False,
        "gold_customers": [],
        "required_terms": [],
    },
    {
        "query_id": "q-009",
        "question": "What risks were identified for a customer named Initech?",
        "intent_category": "unanswerable",
        "answerable": False,
        "gold_customers": [],
        "required_terms": [],
    },
    {
        "query_id": "q-010",
        "question": "Did the customer approve the revised proposal, and has that changed since the original meeting?",
        "intent_category": "temporal_status",
        "answerable": True,
        "gold_customers": ["Contoso"],
        "required_terms": ["approv"],
    },
]
