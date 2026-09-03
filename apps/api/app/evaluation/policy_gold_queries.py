"""Policy-block gold cases -- feature/decision-intelligence-layer, Phase B.

Net-new gold set. This project's existing evaluation harness
(gold_queries.py / gold_queries_v2.py) always evaluates retrieval and
generation quality under one broad tenant-level identity -- it has never
varied *which identity* is asking, so it has never measured whether ACL
enforcement's actual pass/block *outcome* matches expectation across a
range of identities. Real ACL correctness (does the SQL predicate leak
rows) already has a full test suite (`tests/test_phase6_acl.py`) -- this
gold set is for a different purpose: scoring that outcome as a benchmark
metric over time, the same way hit_rate/faithfulness are scored, not
re-testing the mechanism.

Scoped to this project's synthetic Contoso (`owner:alice`) / Globex
(`owner:carol`) sample corpus (see `apps/api/tests/conftest.py`), mirroring
`gold_queries.py`'s own scoping note -- extend this list as real documents
and real owner/customer principals land.

Each entry:
  case_id           unique id
  question          the query text
  principals        the ACL principals the requesting identity holds
                     (mirrors `search_index.SearchFilters.principals`)
  target_customer   the customer_name the question is actually about
  expected_blocked  True if retrieval under `principals` should NOT
                     surface any evidence from `target_customer`
"""
from __future__ import annotations

POLICY_GOLD_QUERIES: list[dict] = [
    {
        "case_id": "pb-001",
        "question": "What risks were raised in the Contoso account review?",
        "principals": ["owner:alice"],
        "target_customer": "Contoso",
        "expected_blocked": False,
    },
    {
        "case_id": "pb-002",
        "question": "What risks were raised in the Globex account review?",
        "principals": ["owner:alice"],
        "target_customer": "Globex",
        "expected_blocked": True,
    },
    {
        "case_id": "pb-003",
        "question": "What risks were raised in the Globex account review?",
        "principals": ["owner:carol"],
        "target_customer": "Globex",
        "expected_blocked": False,
    },
    {
        "case_id": "pb-004",
        "question": "What risks were raised in the Contoso account review?",
        "principals": ["owner:carol"],
        "target_customer": "Contoso",
        "expected_blocked": True,
    },
    {
        "case_id": "pb-005",
        "question": "What actions were assigned after the Contoso meeting?",
        "principals": ["customer:Contoso"],
        "target_customer": "Contoso",
        "expected_blocked": False,
    },
    {
        "case_id": "pb-006",
        "question": "What actions were assigned after the Globex meeting?",
        "principals": ["customer:Contoso"],
        "target_customer": "Globex",
        "expected_blocked": True,
    },
]
