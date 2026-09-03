"""Policy-block accuracy evaluation -- feature/decision-intelligence-layer,
Phase B. Net-new: no existing module measures this.

Scores whether the existing ACL enforcement (SQL-level predicate,
already built and already covered by `tests/test_phase6_acl.py`) actually
produces the pass/block *outcome* each `POLICY_GOLD_QUERIES` case expects,
for a given scoped identity. Reuses the existing ACL-enforcing retrieval
chokepoint (`agentic_retrieval.run`, which threads `SearchFilters.principals`
through to `search_index`'s SQL-level ACL predicate) -- this module never
reimplements ACL filtering, token verification, or the audit trail; it
only calls the existing retrieval path with different principals and
checks the result.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.evaluation.policy_gold_queries import POLICY_GOLD_QUERIES
from app.services import agentic_retrieval, search_index


@dataclass
class PolicyCaseResult:
    case_id: str
    question: str
    principals: list[str]
    target_customer: str
    expected_blocked: bool
    actual_blocked: bool
    correct: bool


def run_policy_block_eval(
    tenant_id: str = "tenant-a",
    cases: list[dict] | None = None,
    top_k: int = 10,
) -> dict:
    cases = cases if cases is not None else POLICY_GOLD_QUERIES
    results: list[PolicyCaseResult] = []

    for case in cases:
        filters = search_index.SearchFilters(tenant_id=tenant_id, principals=case["principals"])
        agentic_result = agentic_retrieval.run(case["question"], top_k=top_k, filters=filters)
        evidence = agentic_result.evidence

        # "blocked" = no evidence at all from the target customer made it
        # through the ACL-filtered retrieval path -- the same signal the
        # real /chat path would abstain on (no evidence -> generation
        # produces an abstention, per the existing abstention logic).
        seen_customers = {c.get("customer_name") for c in evidence if c.get("customer_name")}
        actual_blocked = case["target_customer"] not in seen_customers
        correct = actual_blocked == case["expected_blocked"]

        results.append(
            PolicyCaseResult(
                case_id=case["case_id"],
                question=case["question"],
                principals=list(case["principals"]),
                target_customer=case["target_customer"],
                expected_blocked=case["expected_blocked"],
                actual_blocked=actual_blocked,
                correct=correct,
            )
        )

    n = len(results)
    # The two ways this can go wrong are not equally bad: a case that
    # should have been blocked but wasn't is a real data leak; a case
    # that should have been allowed but got blocked is only an
    # availability bug. Surfaced separately so a dashboard reader can
    # tell which direction any inaccuracy points, not just the aggregate.
    false_allows = [r for r in results if r.expected_blocked and not r.actual_blocked]
    false_blocks = [r for r in results if not r.expected_blocked and r.actual_blocked]

    return {
        "n_cases": n,
        "policy_block_accuracy": round(sum(1 for r in results if r.correct) / n, 4) if n else 0.0,
        "false_allow_count": len(false_allows),
        "false_allow_cases": [r.case_id for r in false_allows],
        "false_block_count": len(false_blocks),
        "false_block_cases": [r.case_id for r in false_blocks],
        "results": [r.__dict__ for r in results],
        "caveat": (
            "false_allow_count is the security-relevant direction (a case that should have been "
            "blocked but returned evidence anyway) -- treat any nonzero value here as a P0, not just "
            "a metric dip. Scoped to this project's synthetic Contoso/Globex sample corpus -- see "
            "policy_gold_queries.py's docstring."
        ),
    }
