"""Evaluation metrics (blueprint Section 7 / 13): Hit Rate@k, MRR@k, and
abstention correctness against the gold query set. Retrieval metrics run
directly against `search_index.hybrid_search` (fast, no LLM call).
Abstention correctness optionally runs the full `/chat`-equivalent path
(agentic retrieval + generation + citation validation) since abstention is
a generation-time decision, not a retrieval-time one.

Numbers produced against this project's local substitutes (hnswlib/FTS5,
and whichever embedding/generation provider is active -- see ADR 0004/0005)
are development-velocity signals, not Azure AI Search production numbers,
per ADR 0001's standing caveat. `/evaluation/run`'s response always reports
`embedding_provider_is_fallback` / `generation_provider_is_fallback` next to
the scores so a reader never mistakes a fallback-provider run for a
production-representative one.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.evaluation.gold_queries import GOLD_QUERIES
from app.services import embeddings, generation, query_rewrite, search_index


@dataclass
class QueryResult:
    query_id: str
    question: str
    intent_category: str
    answerable: bool
    hit: bool
    reciprocal_rank: float
    retrieved_customers: list[str]
    missing_customers: list[str]
    latency_ms: int


@dataclass
class EvalSummary:
    n_queries: int
    hit_rate_at_k: float
    mrr_at_k: float
    by_category: dict[str, dict[str, float]]
    embedding_provider_is_fallback: bool
    reranker_provider_is_fallback: bool
    results: list[QueryResult] = field(default_factory=list)


def _hit_and_rank(retrieved: list[dict[str, Any]], gold_customers: list[str]) -> tuple[bool, float, list[str]]:
    if not gold_customers:
        # Unanswerable-by-design queries: "hit" is undefined at the retrieval
        # layer (there's nothing to find) -- scored separately as abstention
        # correctness, not folded into Hit Rate/MRR.
        return True, 1.0, []
    seen: set[str] = set()
    for rank, chunk in enumerate(retrieved, start=1):
        customer = chunk.get("customer_name")
        if customer:
            seen.add(customer)
        if customer in gold_customers:
            return True, 1.0 / rank, sorted(set(gold_customers) - seen)
    return False, 0.0, sorted(set(gold_customers) - seen)


def run_retrieval_eval(
    top_k: int = 10,
    tenant_id: str = "tenant-a",
    queries: list[dict] | None = None,
) -> EvalSummary:
    queries = queries if queries is not None else GOLD_QUERIES
    results: list[QueryResult] = []
    by_category: dict[str, list[QueryResult]] = {}

    for q in queries:
        start = time.monotonic()
        rw = query_rewrite.rewrite_query(q["question"])
        filters = search_index.SearchFilters(tenant_id=tenant_id)
        retrieved, _trace = search_index.hybrid_search(rw.rewritten_query, top_k=top_k, filters=filters)
        latency_ms = int((time.monotonic() - start) * 1000)

        hit, rr, missing = _hit_and_rank(retrieved, q.get("gold_customers", []))
        retrieved_customers = sorted({c.get("customer_name") for c in retrieved if c.get("customer_name")})

        qr = QueryResult(
            query_id=q["query_id"],
            question=q["question"],
            intent_category=q["intent_category"],
            answerable=q["answerable"],
            hit=hit,
            reciprocal_rank=rr,
            retrieved_customers=retrieved_customers,
            missing_customers=missing,
            latency_ms=latency_ms,
        )
        results.append(qr)
        by_category.setdefault(q["intent_category"], []).append(qr)

    n = len(results)
    hit_rate = sum(1 for r in results if r.hit) / n if n else 0.0
    mrr = sum(r.reciprocal_rank for r in results) / n if n else 0.0

    category_summary = {
        cat: {
            "n": len(rs),
            "hit_rate_at_k": sum(1 for r in rs if r.hit) / len(rs),
            "mrr_at_k": sum(r.reciprocal_rank for r in rs) / len(rs),
        }
        for cat, rs in by_category.items()
    }

    return EvalSummary(
        n_queries=n,
        hit_rate_at_k=hit_rate,
        mrr_at_k=mrr,
        by_category=category_summary,
        embedding_provider_is_fallback=embeddings.provider_is_fallback(),
        reranker_provider_is_fallback=search_index.reranker_is_fallback(),
        results=results,
    )


@dataclass
class AbstentionResult:
    query_id: str
    answerable: bool
    abstained: bool
    correct: bool


def run_abstention_eval(
    tenant_id: str = "tenant-a", queries: list[dict] | None = None
) -> dict[str, Any]:
    """Runs the full retrieval->generation->citation-validation path (same
    shape as /chat) against the gold set's unanswerable + answerable
    queries and checks whether abstention behavior matches `answerable`.
    Slower than run_retrieval_eval (calls generation), so it's a separate,
    opt-in endpoint call."""
    from app.services import agentic_retrieval, citation_validator  # local import: avoid pulling generation into every retrieval-only eval call

    queries = queries if queries is not None else GOLD_QUERIES
    results: list[AbstentionResult] = []
    for q in queries:
        filters = search_index.SearchFilters(tenant_id=tenant_id)
        agentic_result = agentic_retrieval.run(q["question"], top_k=10, filters=filters)
        gen_result = generation.generate_structured_answer(q["question"], agentic_result.evidence)
        validation = citation_validator.validate(gen_result.raw_json, agentic_result.evidence)
        abstained = bool(validation.answer_json.get("abstained"))
        correct = abstained == (not q["answerable"])
        results.append(AbstentionResult(query_id=q["query_id"], answerable=q["answerable"], abstained=abstained, correct=correct))

    n = len(results)
    unanswerable = [r for r in results if not r.answerable]
    answerable = [r for r in results if r.answerable]
    return {
        "n_queries": n,
        "abstention_accuracy_overall": sum(1 for r in results if r.correct) / n if n else 0.0,
        "abstention_precision": (
            sum(1 for r in unanswerable if r.correct) / len(unanswerable) if unanswerable else None
        ),
        "false_abstention_rate": (
            sum(1 for r in answerable if r.abstained) / len(answerable) if answerable else None
        ),
        "generation_provider_is_fallback": generation.provider_is_fallback(),
        "results": [r.__dict__ for r in results],
    }
