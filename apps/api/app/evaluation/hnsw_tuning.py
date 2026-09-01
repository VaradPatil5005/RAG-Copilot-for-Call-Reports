"""Offline HNSW parameter grid search (Phase 6.4).

Never run automatically -- this rebuilds a temporary in-memory hnswlib
index once per (m, ef_construction, ef_search) combination against the
corpus's *current* vectors, so a full grid is expensive: the blueprint's
own suggested grid (m in {4,6,8,10} x efConstruction in {400,600,800,1000}
x efSearch in {200,400,500,600,800}) is 80 temporary index builds. Call
`run_grid_search` with an explicit, deliberately-sized grid via
`/evaluation/hnsw-grid-search`; this module does not run itself.

Selection rule (blueprint Section 8's constrained objective): among
configurations meeting a p95 latency ceiling, prefer the one maximizing a
weighted combination of MRR@10, Recall@10, and mean ANN recall against the
exhaustive-KNN oracle -- never tune on raw vector similarity alone, since a
configuration that improves nearest-neighbor similarity but lowers MRR
after lexical fusion/reranking can be worse in production (this project's
own hybrid_search does BM25+vector+RRF+rerank, not vector search alone).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from itertools import product

import hnswlib
import numpy as np

from app import db
from app.evaluation import ann_recall
from app.evaluation.gold_queries import GOLD_QUERIES
from app.services import embeddings, search_index


@dataclass
class HnswConfig:
    m: int
    ef_construction: int
    ef_search: int


@dataclass
class HnswConfigResult:
    config: HnswConfig
    recall_at_10: float
    mrr_at_10: float
    mean_ann_recall_at_10: float
    p95_latency_ms: float
    index_build_seconds: float
    index_size_points: int


def _build_temp_index(chunk_ids: list[str], vectors: np.ndarray, config: HnswConfig, metric: str = "cosine") -> hnswlib.Index:
    dims = vectors.shape[1]
    index = hnswlib.Index(space=metric, dim=dims)
    index.init_index(max_elements=max(len(chunk_ids), 1), ef_construction=config.ef_construction, M=config.m)
    if len(chunk_ids):
        index.add_items(vectors, list(range(len(chunk_ids))))
    index.set_ef(config.ef_search)
    return index


def _query_temp_index(index: hnswlib.Index, chunk_ids: list[str], query_vec: np.ndarray, k: int) -> list[tuple[str, float]]:
    k = min(k, len(chunk_ids))
    if k == 0:
        return []
    labels, distances = index.knn_query(query_vec, k=k)
    return [(chunk_ids[int(lbl)], 1.0 - float(dist)) for lbl, dist in zip(labels[0], distances[0])]


def _chunk_customer_map(chunk_ids: list[str]) -> dict[str, str | None]:
    if not chunk_ids:
        return {}
    placeholders = ",".join("?" for _ in chunk_ids)
    rows = db.get_connection().execute(
        f"SELECT chunk_id, customer_name FROM chunks WHERE chunk_id IN ({placeholders})", chunk_ids
    ).fetchall()
    return {r["chunk_id"]: r["customer_name"] for r in rows}


def _hit_and_rr(
    results: list[tuple[str, float]], gold_customers: list[str], id_to_customer: dict[str, str | None]
) -> tuple[bool, float]:
    for rank, (chunk_id, _) in enumerate(results, start=1):
        if id_to_customer.get(chunk_id) in gold_customers:
            return True, 1.0 / rank
    return False, 0.0


def evaluate_config(
    config: HnswConfig,
    chunk_ids: list[str],
    vectors: np.ndarray,
    queries: list[dict] | None = None,
    k: int = 10,
) -> HnswConfigResult:
    queries = queries if queries is not None else GOLD_QUERIES
    start = time.monotonic()
    index = _build_temp_index(chunk_ids, vectors, config)
    build_seconds = time.monotonic() - start

    provider = embeddings.get_default_provider()
    id_to_customer = _chunk_customer_map(chunk_ids)
    hits, rrs, latencies, ann_recalls = [], [], [], []

    for q in queries:
        gold_customers = q.get("gold_customers", [])
        if not gold_customers:
            continue  # unanswerable-by-design queries aren't a retrieval-recall signal
        query_vec = np.array(provider.embed_texts([q["question"]])[0], dtype=np.float32)

        t0 = time.monotonic()
        results = _query_temp_index(index, chunk_ids, query_vec, k)
        latencies.append((time.monotonic() - t0) * 1000)

        hit, rr = _hit_and_rr(results, gold_customers, id_to_customer)
        hits.append(hit)
        rrs.append(rr)

        exhaustive = ann_recall.exhaustive_knn(q["question"], k=k, tenant_id=None, principals=None)
        ann_recalls.append(ann_recall.ann_recall_at_k(results, exhaustive, k))

    latencies.sort()
    p95 = latencies[int(0.95 * (len(latencies) - 1))] if latencies else 0.0

    return HnswConfigResult(
        config=config,
        recall_at_10=sum(hits) / len(hits) if hits else 0.0,
        mrr_at_10=sum(rrs) / len(rrs) if rrs else 0.0,
        mean_ann_recall_at_10=sum(ann_recalls) / len(ann_recalls) if ann_recalls else 0.0,
        p95_latency_ms=p95,
        index_build_seconds=build_seconds,
        index_size_points=len(chunk_ids),
    )


@dataclass
class GridSearchSummary:
    grid_size: int
    results: list[HnswConfigResult] = field(default_factory=list)
    selected: HnswConfig | None = None
    selection_reason: str = ""


def run_grid_search(
    m_values: tuple[int, ...] = (4, 6, 8, 10),
    ef_construction_values: tuple[int, ...] = (400, 600, 800, 1000),
    ef_search_values: tuple[int, ...] = (200, 400, 500, 600, 800),
    p95_latency_ceiling_ms: float = 500.0,
    weights: dict[str, float] | None = None,
    queries: list[dict] | None = None,
) -> GridSearchSummary:
    """Runs the given grid (defaults to the blueprint's own). Expensive:
    len(m_values) * len(ef_construction_values) * len(ef_search_values)
    temporary index builds over the full active corpus -- an explicit
    offline step (see `/evaluation/hnsw-grid-search`), not routine CI."""
    weights = weights or {"mrr": 0.5, "recall": 0.3, "ann_recall": 0.2}
    mgr = search_index.get_index_manager()
    chunk_ids, vectors = mgr.get_active_chunk_vectors()

    results = []
    for m, efc, efs in product(m_values, ef_construction_values, ef_search_values):
        config = HnswConfig(m=m, ef_construction=efc, ef_search=efs)
        results.append(evaluate_config(config, chunk_ids, vectors, queries=queries))

    eligible = [r for r in results if r.p95_latency_ms <= p95_latency_ceiling_ms]
    pool = eligible or results  # nothing met the ceiling -- report the best anyway, and say so
    best = max(
        pool,
        key=lambda r: (
            weights["mrr"] * r.mrr_at_10 + weights["recall"] * r.recall_at_10 + weights["ann_recall"] * r.mean_ann_recall_at_10
        ),
    )
    reason = (
        f"Best weighted utility (mrr={weights['mrr']}, recall={weights['recall']}, "
        f"ann_recall={weights['ann_recall']}) among configs "
        f"{'meeting' if eligible else 'NOT meeting -- none did'} the {p95_latency_ceiling_ms}ms p95 ceiling."
    )
    return GridSearchSummary(grid_size=len(results), results=results, selected=best.config, selection_reason=reason)
