"""300+ query stratified gold benchmark (Phase 6.4), generated
programmatically from `synthetic_corpus.py`'s known ground truth --
matching the blueprint's stratification table:

    single_document_fact        20%
    multi_document_synthesis    20%
    temporal_status             15%
    table_lookup                15%
    entity_comparison           10%
    cross_document_graph        10%
    unanswerable                10%

Every query's "gold answer" is derivable from the ground truth used to
generate the corpus (since we wrote the content), not hand-authored or
SME-annotated -- this is the honest alternative the Phase 6 spec calls
for over padding `gold_queries.py`'s original 10 hand-written queries
with near-duplicates against a 3-document corpus. It gives a real signal
on retrieval/generation behavior at a scale (40 documents, 20 customers,
shared competitors, multi-version documents) the original small corpus
could not exercise; it is still not a substitute for real SME-labeled
enterprise data, and that gap is documented here and in ADR 0007, not
hidden by the larger number.

Same proxy-label convention as `gold_queries.py`: `gold_customers` (not
hand-labeled chunk_ids), since ingested document/chunk IDs are generated
per-upload and aren't stable across re-ingests of this corpus.
"""
from __future__ import annotations

from app.evaluation.synthetic_corpus import CustomerProfile

TARGET_PROPORTIONS = {
    "single_document_fact": 0.20,
    "multi_document_synthesis": 0.20,
    "temporal_status": 0.15,
    "table_lookup": 0.15,
    "entity_comparison": 0.10,
    "cross_document_graph": 0.10,
    "unanswerable": 0.10,
}


def _q(query_id: str, question: str, intent: str, answerable: bool, gold_customers: list[str], required_terms: list[str], difficulty: str) -> dict:
    return {
        "query_id": query_id,
        "question": question,
        "intent_category": intent,
        "answerable": answerable,
        "gold_customers": gold_customers,
        "required_terms": required_terms,
        "difficulty": difficulty,
    }


def generate_stratified_gold_queries(profiles: list[CustomerProfile]) -> list[dict]:
    queries: list[dict] = []
    n = 0

    def next_id() -> str:
        nonlocal n
        n += 1
        return f"syn-q-{n:03d}"

    # -- single_document_fact (target 20%): risks / actions / competitors,
    # one document (the "original" report) per customer, 3 templates.
    for p in profiles:
        queries.append(_q(next_id(), f"What risks were raised for {p.customer}?", "single_document_fact", True, [p.customer], ["risk"], "easy"))
        queries.append(_q(next_id(), f"What actions were assigned after the {p.customer} meeting?", "single_document_fact", True, [p.customer], ["action"], "easy"))
        queries.append(_q(next_id(), f"Which competitors did {p.customer} mention?", "single_document_fact", True, [p.customer], [c.lower() for c in p.competitors], "moderate"))

    # -- multi_document_synthesis (target 20%): spans both reports of one
    # customer, or across several customers.
    for p in profiles:
        queries.append(_q(next_id(), f"What is the complete history of risks discussed for {p.customer} across both meetings?", "multi_document_synthesis", True, [p.customer], ["risk"], "moderate"))
        queries.append(_q(next_id(), f"What is the complete history of open actions for {p.customer} across both meetings?", "multi_document_synthesis", True, [p.customer], ["action"], "moderate"))

    competitor_to_customers: dict[str, list[str]] = {}
    for p in profiles:
        for c in p.competitors:
            competitor_to_customers.setdefault(c, []).append(p.customer)
    for competitor, customers in competitor_to_customers.items():
        if len(customers) >= 2:
            queries.append(
                _q(next_id(), f"Which customers mentioned {competitor} as a competitor?", "multi_document_synthesis", True, customers, [competitor.lower()], "hard")
            )
    for a, b in zip(profiles[::2], profiles[1::2]):
        queries.append(_q(next_id(), f"Compare the competitors mentioned by {a.customer} and {b.customer}.", "multi_document_synthesis", True, [a.customer, b.customer], ["competitor"], "hard"))

    # -- temporal_status (target 15%): original-vs-followup status.
    for p in profiles:
        queries.append(_q(next_id(), f"Has {p.customer} approved the proposal, and did that change since the first meeting?", "temporal_status", True, [p.customer], ["approv"], "hard"))
        queries.append(_q(next_id(), f"What is the current approval status for {p.customer}?", "temporal_status", True, [p.customer], ["approv"], "moderate"))

    # -- table_lookup (target 15%): pipeline metric queries.
    for p in profiles:
        queries.append(_q(next_id(), f"What was the Q1 2026 pipeline value discussed for {p.customer}?", "table_lookup", True, [p.customer], ["pipeline"], "moderate"))
        queries.append(_q(next_id(), f"What was the Q2 2026 pipeline value discussed for {p.customer}?", "table_lookup", True, [p.customer], ["pipeline"], "moderate"))
    high_pipeline_customers = [p.customer for p in profiles if p.pipeline_q2 > 1_000_000]
    if high_pipeline_customers:
        queries.append(
            _q(next_id(), "Which customers had a Q2 2026 pipeline value above $1,000,000?", "table_lookup", True, high_pipeline_customers, ["pipeline"], "hard")
        )

    # -- entity_comparison (target 10%): pairwise comparisons + alias variants.
    for a, b in zip(profiles[::2], profiles[1::2]):
        queries.append(_q(next_id(), f"Compare the open actions between {a.customer} and {b.customer}.", "entity_comparison", True, [a.customer, b.customer], ["action"], "hard"))
    for p in profiles:
        if p.competitors:
            alias = p.competitors[0].replace(" Corp", " Corporation").upper()
            queries.append(_q(next_id(), f"Did {p.customer} mention {alias} in their evaluation?", "entity_comparison", True, [p.customer], [p.competitors[0].split()[0].lower()], "hard"))

    # -- cross_document_graph (target 10%): the blueprint's own canonical
    # phrasing, routed through the Copilot's cross_document_graph intent.
    for competitor, customers in competitor_to_customers.items():
        if len(customers) >= 2:
            queries.append(
                _q(next_id(), f"Which customers mention the same competitor as {customers[0]}?", "cross_document_graph", True, customers, [competitor.lower()], "hard")
            )
    for p in profiles:
        queries.append(_q(next_id(), f"What risks connect {p.customer} to other accounts?", "cross_document_graph", True, [p.customer], ["risk"], "hard"))

    # -- unanswerable (target 10%): out-of-scope numeric facts + nonexistent customers.
    for p in profiles[:15]:
        queries.append(_q(next_id(), f"What was {p.customer}'s total annual revenue last year?", "unanswerable", False, [], [], "moderate"))
    for fake_name in ["Northwind Traders", "Fabrikam", "Adatum Corp", "Litware Inc", "Contoso Pharmaceuticals"]:
        queries.append(_q(next_id(), f"What risks were identified for a customer named {fake_name}?", "unanswerable", False, [], [], "moderate"))

    return queries


def validate_stratification(queries: list[dict], tolerance: float = 0.05) -> dict:
    """Checks the generated set's actual category proportions against
    `TARGET_PROPORTIONS` within `tolerance` -- the Phase 6.4 spec's
    explicit test requirement ('stratification proportions roughly match
    the target table')."""
    n = len(queries)
    counts: dict[str, int] = {}
    for q in queries:
        counts[q["intent_category"]] = counts.get(q["intent_category"], 0) + 1
    report = {}
    all_ok = True
    for category, target in TARGET_PROPORTIONS.items():
        actual = counts.get(category, 0) / n if n else 0.0
        ok = abs(actual - target) <= tolerance
        all_ok = all_ok and ok
        report[category] = {"target": target, "actual": round(actual, 3), "count": counts.get(category, 0), "within_tolerance": ok}
    return {"n_queries": n, "all_within_tolerance": all_ok, "by_category": report}
