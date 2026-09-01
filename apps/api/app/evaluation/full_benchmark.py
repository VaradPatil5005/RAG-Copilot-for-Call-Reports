"""Full evaluation benchmark (Phase 6.4): retrieval -> generation ->
citation validation across the whole gold query set, every metric the
blueprint asks for, per-category breakdowns with confidence intervals,
and an explicit failure/abstention case listing -- matching the spec's
requirement that any "system outperformed baseline" claim carry its exact
denominator, definition of "outperformed", and the cases where the system
lost, not just an aggregate number.

This is the slow path (one full retrieval+generation+validation call per
query) -- `metrics.run_retrieval_eval` stays the fast retrieval-only path
for quick iteration; this is what `/evaluation/run-full` calls for a real
benchmark pass.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.evaluation import quality_metrics
from app.evaluation.gold_queries import GOLD_QUERIES
from app.services import agentic_retrieval, citation_validator, embeddings, generation, search_index


@dataclass
class FullQueryResult:
    query_id: str
    question: str
    intent_category: str
    difficulty: str
    answerable: bool
    hit: bool
    reciprocal_rank: float
    abstained: bool
    abstention_correct: bool
    semantic_relevancy: float
    relevancy_judge: str
    citation_precision: float | None
    citation_recall: float | None
    faithfulness: float
    latency_ms: float
    answer_preview: str


def _hit_and_rank(retrieved: list[dict[str, Any]], gold_customers: list[str]) -> tuple[bool, float]:
    if not gold_customers:
        return True, 1.0
    for rank, chunk in enumerate(retrieved, start=1):
        if chunk.get("customer_name") in gold_customers:
            return True, 1.0 / rank
    return False, 0.0


def run_full_benchmark(
    queries: list[dict] | None = None,
    top_k: int = 10,
    tenant_id: str = "tenant-a",
    principals: list[str] | None = None,
) -> dict:
    queries = queries if queries is not None else GOLD_QUERIES
    results: list[FullQueryResult] = []
    filters = search_index.SearchFilters(tenant_id=tenant_id, principals=principals)

    for q in queries:
        start = time.monotonic()
        agentic_result = agentic_retrieval.run(q["question"], top_k=top_k, filters=filters)
        evidence = agentic_result.evidence
        evidence_by_id = {c["chunk_id"]: c for c in evidence}

        gen_result = generation.generate_structured_answer(q["question"], evidence)
        validation = citation_validator.validate(gen_result.raw_json, evidence)
        latency_ms = (time.monotonic() - start) * 1000

        answer_json = validation.answer_json
        abstained = bool(answer_json.get("abstained"))
        answerable = q["answerable"]
        abstention_correct = abstained == (not answerable)

        hit, rr = _hit_and_rank(evidence, q.get("gold_customers", []))
        relevancy, judge = quality_metrics.score_semantic_relevancy(q["question"], answer_json.get("answer") or "")
        cpr = quality_metrics.score_citation_precision_recall(
            answer_json.get("citations") or [], evidence_by_id, q.get("gold_customers", [])
        )
        faithfulness = quality_metrics.score_faithfulness(validation)

        results.append(
            FullQueryResult(
                query_id=q["query_id"],
                question=q["question"],
                intent_category=q["intent_category"],
                difficulty=q.get("difficulty", "unspecified"),
                answerable=answerable,
                hit=hit,
                reciprocal_rank=rr,
                abstained=abstained,
                abstention_correct=abstention_correct,
                semantic_relevancy=relevancy,
                relevancy_judge=judge,
                citation_precision=cpr.precision,
                citation_recall=cpr.recall,
                faithfulness=faithfulness,
                latency_ms=round(latency_ms, 1),
                answer_preview=(answer_json.get("answer") or "")[:200],
            )
        )

    return _summarize(results)


def _summarize(results: list[FullQueryResult]) -> dict:
    n = len(results)
    by_category: dict[str, list[FullQueryResult]] = {}
    for r in results:
        by_category.setdefault(r.intent_category, []).append(r)

    def category_block(rs: list[FullQueryResult]) -> dict:
        n_r = len(rs)
        hits = sum(1 for r in rs if r.hit)
        abst_correct = sum(1 for r in rs if r.abstention_correct)
        ci_lo, ci_hi = quality_metrics.wilson_confidence_interval(hits, n_r)
        latencies = [r.latency_ms for r in rs]
        return {
            "n": n_r,
            "hit_rate": round(hits / n_r, 4) if n_r else 0.0,
            "hit_rate_95ci": [ci_lo, ci_hi],
            "mrr": round(sum(r.reciprocal_rank for r in rs) / n_r, 4) if n_r else 0.0,
            "abstention_accuracy": round(abst_correct / n_r, 4) if n_r else 0.0,
            "mean_semantic_relevancy": round(sum(r.semantic_relevancy for r in rs) / n_r, 3) if n_r else 0.0,
            "mean_faithfulness": round(sum(r.faithfulness for r in rs) / n_r, 3) if n_r else 0.0,
            "latency_ms": quality_metrics.percentiles(latencies),
        }

    by_category_summary = {cat: category_block(rs) for cat, rs in by_category.items()}

    overall_hits = sum(1 for r in results if r.hit)
    overall_ci = quality_metrics.wilson_confidence_interval(overall_hits, n)
    all_latencies = [r.latency_ms for r in results]

    failures = [
        {
            "query_id": r.query_id,
            "question": r.question,
            "intent_category": r.intent_category,
            "reason": (
                "retrieval_miss" if not r.hit and r.answerable
                else "abstention_mismatch" if not r.abstention_correct
                else "low_faithfulness" if r.faithfulness < 0.5
                else "low_relevancy"
            ),
            "faithfulness": r.faithfulness,
            "semantic_relevancy": r.semantic_relevancy,
        }
        for r in results
        if (not r.hit and r.answerable) or not r.abstention_correct or r.faithfulness < 0.5 or r.semantic_relevancy < 2.0
    ]

    judges_used = {r.relevancy_judge for r in results}

    return {
        "n_queries": n,
        "overall": {
            "hit_rate": round(overall_hits / n, 4) if n else 0.0,
            "hit_rate_95ci": list(overall_ci),
            "mrr": round(sum(r.reciprocal_rank for r in results) / n, 4) if n else 0.0,
            "abstention_accuracy": round(sum(1 for r in results if r.abstention_correct) / n, 4) if n else 0.0,
            "mean_semantic_relevancy": round(sum(r.semantic_relevancy for r in results) / n, 3) if n else 0.0,
            "mean_faithfulness": round(sum(r.faithfulness for r in results) / n, 3) if n else 0.0,
            "latency_ms": quality_metrics.percentiles(all_latencies),
        },
        "by_category": by_category_summary,
        "failure_cases": failures,
        "n_failure_cases": len(failures),
        "semantic_relevancy_judge_used": sorted(judges_used),
        "embedding_provider_is_fallback": embeddings.provider_is_fallback(),
        "generation_provider_is_fallback": generation.provider_is_fallback(),
        "caveat": (
            "Confidence intervals are Wilson score intervals over this query sample's hit-rate proportion "
            "only (not a claim about a population beyond this gold set). If "
            "semantic_relevancy_judge_used includes 'heuristic_fallback', semantic relevancy scores are a "
            "crude token-overlap proxy, not an LLM judgment -- see quality_metrics.py. If either provider "
            "fallback flag is true, discard these numbers as a production signal (ADR 0004/0005/0007)."
        ),
    }
