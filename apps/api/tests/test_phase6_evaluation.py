"""Phase 6.4 tests: the 300+ query stratified gold set's structure and
proportions, the exhaustive-KNN oracle's recall computation on a small
controlled example, and the full benchmark's report structure (per-
category metrics + confidence intervals), per the spec's explicit test
list.

Running the *actual* 300+ query benchmark against a fully-ingested
40-document synthetic corpus is a genuinely slow operation (48 real
pipeline runs plus 300+ real generation calls) that belongs in a manual/
CI-scheduled job, not the default test suite -- these tests validate the
harness's correctness on the existing small `ingested` fixture corpus and
on hand-constructed inputs, which is exactly what the spec's own test
list asks for ("verify the recall computation itself with a small
controlled synthetic example where the answer is known").
"""
from __future__ import annotations

from app.evaluation import full_benchmark, quality_metrics
from app.evaluation.gold_queries import GOLD_QUERIES
from app.evaluation.gold_queries_v2 import TARGET_PROPORTIONS, generate_stratified_gold_queries, validate_stratification
from app.evaluation.synthetic_corpus import generate_customer_profiles

REQUIRED_FIELDS = {"query_id", "question", "intent_category", "answerable", "gold_customers", "required_terms", "difficulty"}


# --------------------------------------------------------------------------
# 300+ query gold set: structure and stratification
# --------------------------------------------------------------------------


def test_gold_set_v2_has_300_or_more_queries():
    profiles = generate_customer_profiles(n=24, seed=42)
    queries = generate_stratified_gold_queries(profiles)
    assert len(queries) >= 300


def test_gold_set_v2_query_ids_are_unique():
    profiles = generate_customer_profiles(n=24, seed=42)
    queries = generate_stratified_gold_queries(profiles)
    ids = [q["query_id"] for q in queries]
    assert len(ids) == len(set(ids))


def test_gold_set_v2_every_query_has_required_fields():
    profiles = generate_customer_profiles(n=24, seed=42)
    queries = generate_stratified_gold_queries(profiles)
    for q in queries:
        missing = REQUIRED_FIELDS - q.keys()
        assert not missing, f"{q.get('query_id')} missing fields: {missing}"
        assert q["intent_category"] in TARGET_PROPORTIONS
        assert q["difficulty"] in {"easy", "moderate", "hard", "multi-hop", "OCR-heavy", "table-heavy", "contradictory"}


def test_gold_set_v2_stratification_matches_target_table():
    profiles = generate_customer_profiles(n=24, seed=42)
    queries = generate_stratified_gold_queries(profiles)
    report = validate_stratification(queries)
    assert report["all_within_tolerance"], report["by_category"]
    # Every category from the blueprint's table must actually be present.
    assert set(report["by_category"].keys()) == set(TARGET_PROPORTIONS.keys())


def test_gold_set_v2_is_deterministic_given_a_seed():
    p1 = generate_customer_profiles(n=24, seed=42)
    p2 = generate_customer_profiles(n=24, seed=42)
    q1 = generate_stratified_gold_queries(p1)
    q2 = generate_stratified_gold_queries(p2)
    assert [q["question"] for q in q1] == [q["question"] for q in q2]


# --------------------------------------------------------------------------
# Exhaustive-KNN recall oracle: verify the computation itself
# --------------------------------------------------------------------------


def test_ann_recall_computation_on_a_controlled_synthetic_example():
    from app.evaluation.ann_recall import ann_recall_at_k

    exhaustive = [("A", 0.9), ("B", 0.8), ("C", 0.7), ("D", 0.6), ("E", 0.5)]
    hnsw_3_of_5_correct = [("A", 0.9), ("B", 0.8), ("X", 0.75), ("D", 0.6), ("Y", 0.55)]

    assert ann_recall_at_k(hnsw_3_of_5_correct, exhaustive, k=5) == 0.6
    assert ann_recall_at_k(exhaustive, exhaustive, k=5) == 1.0
    assert ann_recall_at_k([("Z", 0.1)] * 5, exhaustive, k=5) == 0.0
    # Only the top-k window counts, even if extra items are passed in.
    assert ann_recall_at_k(exhaustive + [("F", 0.1)], exhaustive, k=5) == 1.0


def test_exhaustive_knn_oracle_matches_hnswlib_on_the_real_ingested_corpus(ingested):
    """Not a recall assertion (the tiny 3-document corpus doesn't stress
    approximate-vs-exact disagreement) -- confirms the oracle actually
    runs end-to-end against the real index and returns a sane, bounded
    recall value."""
    from app.evaluation import ann_recall

    summary = ann_recall.run_ann_recall_eval(["Contoso pricing risks"], k=5, tenant_id="tenant-a")
    assert summary.n_queries == 1
    assert 0.0 <= summary.mean_ann_recall_at_k <= 1.0


# --------------------------------------------------------------------------
# Quality metrics: pure-function checks
# --------------------------------------------------------------------------


def test_percentiles_on_a_known_distribution():
    latencies = list(range(1, 101))  # 1..100
    p = quality_metrics.percentiles([float(x) for x in latencies])
    assert p["p50"] == 50.0 or p["p50"] == 51.0  # index rounding at the boundary
    assert p["p99"] >= 98.0


def test_wilson_confidence_interval_widens_with_smaller_n():
    lo_small, hi_small = quality_metrics.wilson_confidence_interval(8, 10)
    lo_big, hi_big = quality_metrics.wilson_confidence_interval(80, 100)
    assert (hi_small - lo_small) > (hi_big - lo_big)


def test_faithfulness_is_1_when_there_are_no_citations_to_fail():
    from app.services import citation_validator

    result = citation_validator.ValidationResult(answer_json={"abstained": True, "citations": []}, checks=[])
    assert quality_metrics.score_faithfulness(result) == 1.0


# --------------------------------------------------------------------------
# Full benchmark: report structure (per-category metrics + CIs)
# --------------------------------------------------------------------------


def test_full_benchmark_produces_a_structured_report_with_confidence_intervals(ingested):
    report = full_benchmark.run_full_benchmark(queries=GOLD_QUERIES[:4], top_k=8, tenant_id="tenant-a")
    assert report["n_queries"] == 4
    assert "hit_rate_95ci" in report["overall"]
    assert len(report["overall"]["hit_rate_95ci"]) == 2
    assert report["overall"]["hit_rate_95ci"][0] <= report["overall"]["hit_rate_95ci"][1]
    assert "by_category" in report and report["by_category"]
    for cat_block in report["by_category"].values():
        assert "hit_rate_95ci" in cat_block
        assert "latency_ms" in cat_block
        assert {"p50", "p95", "p99"} <= cat_block["latency_ms"].keys()
    # Explicitly required: not just an aggregate number.
    assert "failure_cases" in report
    assert isinstance(report["embedding_provider_is_fallback"], bool)
    assert isinstance(report["generation_provider_is_fallback"], bool)
