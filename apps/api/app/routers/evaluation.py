"""Evaluation API (blueprint Section 7 / 13 / priority improvement #5).

    GET  /evaluation/gold-set                    -> the seed 10-query gold set
    GET  /evaluation/gold-set-v2                  -> the 300+ query stratified
                                                       synthetic benchmark (Phase 6.4)
    POST /evaluation/run                          -> Hit Rate@k / MRR@k, retrieval-only (fast)
    POST /evaluation/run-abstention                -> abstention accuracy, full path (slower)
    POST /evaluation/run-full                       -> the Phase 6.4 full benchmark:
                                                        retrieval+generation+citation
                                                        validation+every metric, over
                                                        whichever query set is passed
    POST /evaluation/synthetic-corpus/generate       -> writes the Phase 6.4 synthetic
                                                         corpus PDFs to disk (does not
                                                         ingest them -- see docstring)
    GET  /evaluation/ann-recall                       -> exhaustive-KNN oracle vs hnswlib,
                                                          ANNRecall@k over a query sample
    POST /evaluation/hnsw-grid-search                  -> offline HNSW parameter grid
                                                           search (slow, opt-in)

See app/evaluation/metrics.py and app/evaluation/quality_metrics.py for the
caveat on what these numbers do and don't represent in this sandbox.

This router is intentionally unauthenticated (no `Depends(auth.require_identity)`)
-- it's an internal/system evaluation harness scoped by an explicit
`tenant_id` request field, the same posture as the existing `/evaluation/run`
and `/evaluation/run-abstention` endpoints it extends, not an end-user data
path. A real deployment would put this behind an operator/admin-only auth
policy (role-based, not identity-based) -- tracked as a Phase 6.5 gap.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from app.evaluation import ann_recall, full_benchmark, hnsw_tuning, metrics
from app.evaluation.gold_queries import GOLD_QUERIES
from app.evaluation.gold_queries_v2 import generate_stratified_gold_queries, validate_stratification
from app.evaluation.synthetic_corpus import generate_corpus

router = APIRouter(prefix="/evaluation", tags=["evaluation"])


class EvalRunRequest(BaseModel):
    top_k: int = 10
    tenant_id: str = "tenant-a"


@router.get("/gold-set")
def gold_set() -> dict:
    by_category: dict[str, int] = {}
    for q in GOLD_QUERIES:
        by_category[q["intent_category"]] = by_category.get(q["intent_category"], 0) + 1
    return {"n_queries": len(GOLD_QUERIES), "by_category": by_category, "queries": GOLD_QUERIES}


@router.get("/gold-set-v2")
def gold_set_v2(n_customers: int = 24, seed: int = 42) -> dict:
    """The Phase 6.4 300+ query stratified set, generated from the
    synthetic corpus's ground truth (see gold_queries_v2.py's docstring
    for what this is and isn't a substitute for). Query content only --
    running these against real evidence requires the corpus itself to
    have been generated and ingested first (see /synthetic-corpus/generate)."""
    from app.evaluation.synthetic_corpus import generate_customer_profiles

    profiles = generate_customer_profiles(n_customers, seed=seed)
    queries = generate_stratified_gold_queries(profiles)
    stratification = validate_stratification(queries)
    return {"n_queries": len(queries), "stratification": stratification, "queries": queries}


@router.post("/synthetic-corpus/generate")
def generate_synthetic_corpus(n_customers: int = 24, seed: int = 42, output_dir: str = "data/synthetic_corpus") -> dict:
    """Writes 2*n_customers PDFs to `output_dir` (default under this API's
    own `data/` directory) -- does NOT upload/ingest them. Ingestion is a
    separate, slow, per-document step through the real `/documents/upload`
    pipeline (malware scan, layout extraction, chunking, embedding,
    indexing, graph extraction) -- intentionally not triggered
    automatically from this endpoint, since 2*n_customers real pipeline
    runs is exactly the kind of operation that should be an explicit,
    observable, resumable step (a script or test fixture looping over the
    returned file list and calling /documents/upload for each), not a
    single opaque request that can time out partway through."""
    path = Path(output_dir)
    profiles, docs = generate_corpus(path, n_customers=n_customers, seed=seed)
    return {
        "output_dir": str(path),
        "n_documents": len(docs),
        "documents": [
            {
                "path": str(d.path),
                "customer_name": d.profile.customer,
                "account_owner": d.profile.owner,
                "meeting_date": d.profile.meeting_date_followup if d.report == "followup" else d.profile.meeting_date_original,
                "report": d.report,
            }
            for d in docs
        ],
    }


@router.post("/run")
def run(req: EvalRunRequest) -> dict:
    summary = metrics.run_retrieval_eval(top_k=req.top_k, tenant_id=req.tenant_id)
    return {
        "n_queries": summary.n_queries,
        "hit_rate_at_k": round(summary.hit_rate_at_k, 4),
        "mrr_at_k": round(summary.mrr_at_k, 4),
        "by_category": summary.by_category,
        "embedding_provider_is_fallback": summary.embedding_provider_is_fallback,
        "reranker_provider_is_fallback": summary.reranker_provider_is_fallback,
        "results": [r.__dict__ for r in summary.results],
        "caveat": (
            "Numbers reflect this deployment's active embedding/reranker/generation "
            "providers (see /system/health) and the seed gold set (10 queries), not "
            "the blueprint's 300+-query production benchmark -- use /run-full with the "
            "gold-set-v2 queries for that. Discard as a production "
            "signal if either provider_is_fallback flag is true -- see ADR 0004/0005."
        ),
    }


@router.post("/run-abstention")
def run_abstention(req: EvalRunRequest) -> dict:
    result = metrics.run_abstention_eval(tenant_id=req.tenant_id)
    result["caveat"] = (
        "Runs the full retrieval->generation->citation-validation path. If "
        "generation_provider_is_fallback is true, this reflects the deterministic "
        "extractive fallback's abstention behavior, not a real instruction-tuned "
        "model's -- see ADR 0005."
    )
    return result


class FullRunRequest(BaseModel):
    top_k: int = 10
    tenant_id: str = "tenant-a"
    use_v2_gold_set: bool = False
    n_customers: int = 24
    seed: int = 42


@router.post("/run-full")
def run_full(req: FullRunRequest) -> dict:
    """Phase 6.4: the full benchmark -- retrieval + generation + citation
    validation + every metric (semantic relevancy, citation precision/
    recall, faithfulness, abstention, latency percentiles), per-category
    breakdown with confidence intervals, and an explicit failure-case
    listing. Slow: one real generation call per query. Requires the
    corresponding corpus to already be ingested (via /documents/upload) --
    this endpoint does not ingest anything itself. Persists the report
    (Phase 6.6) so the Admin panel can surface it via /evaluation/latest
    without re-running the benchmark."""
    queries = None
    if req.use_v2_gold_set:
        from app.evaluation.synthetic_corpus import generate_customer_profiles

        profiles = generate_customer_profiles(req.n_customers, seed=req.seed)
        queries = generate_stratified_gold_queries(profiles)
    report = full_benchmark.run_full_benchmark(queries=queries, top_k=req.top_k, tenant_id=req.tenant_id)

    import uuid
    from datetime import datetime, timezone

    from app import db

    run_id = f"eval-{uuid.uuid4().hex[:12]}"
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO evaluation_runs (run_id, kind, n_queries, report_json, created_at) VALUES (?,?,?,?,?)",
            (run_id, "run_full", report["n_queries"], db.dumps(report), datetime.now(timezone.utc).isoformat()),
        )
    report["run_id"] = run_id
    return report


@router.get("/latest")
def latest_run() -> dict:
    """Phase 6.6: the most recent persisted /run-full report, for the
    Admin panel's Evaluation view -- reads a real persisted record, never
    a mock or placeholder."""
    from app import db

    row = db.row_to_dict(
        db.get_connection().execute("SELECT * FROM evaluation_runs ORDER BY created_at DESC LIMIT 1").fetchone()
    )
    if not row:
        return {"available": False, "message": "No /evaluation/run-full has been recorded yet."}
    report = db.loads(row["report_json"], {})
    report["run_id"] = row["run_id"]
    report["created_at"] = row["created_at"]
    report["available"] = True
    return report


class AnnRecallRequest(BaseModel):
    queries: list[str] | None = None
    k: int = 10
    tenant_id: str = "tenant-a"


@router.post("/ann-recall")
def run_ann_recall(req: AnnRecallRequest) -> dict:
    """Exhaustive-KNN recall oracle (Phase 6.4) -- has never been run in
    this project before this phase (see ADR 0004). Pass an explicit,
    small `queries` list (10-20% of the corpus's worth of representative
    questions, per the blueprint) since this is O(queries * corpus size)."""
    queries = req.queries or [q["question"] for q in GOLD_QUERIES]
    summary = ann_recall.run_ann_recall_eval(queries, k=req.k, tenant_id=req.tenant_id)
    return {
        "n_queries": summary.n_queries,
        "k": summary.k,
        "mean_ann_recall_at_k": round(summary.mean_ann_recall_at_k, 4),
        "per_query": summary.per_query,
        "caveat": (
            "ANNRecall@k measures agreement between hnswlib's approximate results and this "
            "module's brute-force exact cosine ranking over the same authorized vector set. "
            "Low ANNRecall -> tune efSearch/m/efConstruction (see /hnsw-grid-search) before "
            "changing the embedding model; high ANNRecall with low MRR -> the problem is "
            "chunking/query formulation/lexical matching/reranking, not the ANN index."
        ),
    }


class GridSearchRequest(BaseModel):
    m_values: list[int] = [4, 6, 8, 10]
    ef_construction_values: list[int] = [400, 600, 800, 1000]
    ef_search_values: list[int] = [200, 400, 500, 600, 800]
    p95_latency_ceiling_ms: float = 500.0


@router.post("/hnsw-grid-search")
def run_hnsw_grid_search(req: GridSearchRequest) -> dict:
    """Phase 6.4: the blueprint's own offline HNSW grid search. SLOW --
    len(m_values)*len(ef_construction_values)*len(ef_search_values)
    temporary index rebuilds over the corpus's full active vector set
    (80 builds for the default grid). Call with a smaller grid for a
    quick check; the default mirrors the blueprint's suggested ranges."""
    summary = hnsw_tuning.run_grid_search(
        m_values=tuple(req.m_values),
        ef_construction_values=tuple(req.ef_construction_values),
        ef_search_values=tuple(req.ef_search_values),
        p95_latency_ceiling_ms=req.p95_latency_ceiling_ms,
    )
    return {
        "grid_size": summary.grid_size,
        "selected": summary.selected.__dict__ if summary.selected else None,
        "selection_reason": summary.selection_reason,
        "results": [
            {**r.config.__dict__, **{k: v for k, v in r.__dict__.items() if k != "config"}} for r in summary.results
        ],
    }
