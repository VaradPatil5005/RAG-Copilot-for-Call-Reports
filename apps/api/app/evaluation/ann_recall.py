"""Exhaustive-KNN recall oracle (Phase 6.4).

Brute-force exact vector search over the corpus, compared against the
production hnswlib approximate results, to compute ANNRecall@k per the
blueprint's formula:

    ANNRecall@k(q) = |E_q^(k) ∩ H_q^(k)| / k

where E is the exhaustive top-k chunk_id set for query q and H is HNSW's
top-k chunk_id set. ADR 0004 flagged this as never having been run in
this project; this module is what makes it runnable. Running it against
the full corpus (`run_ann_recall_eval`) is a deliberate, separate,
opt-in step -- not something every retrieval call or even every
`/evaluation/run` call pays the O(n) brute-force cost of.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app import db
from app.services import embeddings, search_index


def _cosine_topk(query_vec: np.ndarray, vectors: np.ndarray, chunk_ids: list[str], k: int) -> list[tuple[str, float]]:
    """The oracle's actual ranking step -- deliberately simple and
    O(n log n), not optimized, since its entire value is being *obviously
    correct* (nothing approximate about it), not fast."""
    if vectors.shape[0] == 0:
        return []
    q = query_vec / (np.linalg.norm(query_vec) + 1e-12)
    v = vectors / (np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-12)
    sims = v @ q
    k = min(k, len(chunk_ids))
    order = np.argsort(-sims)[:k]
    return [(chunk_ids[i], float(sims[i])) for i in order]


def _authorized_subset(
    chunk_ids: list[str], vectors: np.ndarray, tenant_id: str | None, principals: list[str] | None
) -> tuple[list[str], np.ndarray]:
    """Applies the exact same SQL ACL predicate production retrieval uses
    (`db.acl_predicate_sql`) to the oracle's candidate universe, so a
    recall comparison is apples-to-apples: both the oracle and hnswlib
    are being asked "of what this identity may see, what's most similar"
    -- not "of everything in the DB.\""""
    if tenant_id is None and principals is None:
        return chunk_ids, vectors
    if not chunk_ids:
        return [], vectors
    conn = db.get_connection()
    placeholders = ",".join("?" for _ in chunk_ids)
    sql = f"SELECT chunk_id FROM chunks WHERE chunk_id IN ({placeholders})"
    params: list = list(chunk_ids)
    if tenant_id:
        sql += " AND tenant_id = ?"
        params.append(tenant_id)
    acl_sql, acl_params = db.acl_predicate_sql(principals)
    if acl_sql:
        sql += f" AND {acl_sql}"
        params.extend(acl_params)
    authorized = {r["chunk_id"] for r in conn.execute(sql, params).fetchall()}
    keep_idx = [i for i, c in enumerate(chunk_ids) if c in authorized]
    if not keep_idx:
        return [], np.zeros((0, vectors.shape[1] if vectors.ndim == 2 else 0), dtype=np.float32)
    return [chunk_ids[i] for i in keep_idx], vectors[keep_idx]


def exhaustive_knn(
    query_text: str, k: int, tenant_id: str | None = "tenant-a", principals: list[str] | None = None
) -> list[tuple[str, float]]:
    """Returns [(chunk_id, cosine_similarity)] best-first, computed by
    brute force over every vector hnswlib currently has stored (its exact,
    full-precision copy -- see `IndexManager.get_active_chunk_vectors`),
    restricted to the same authorized universe production search would use."""
    mgr = search_index.get_index_manager()
    provider = embeddings.get_default_provider()
    query_vec = np.array(provider.embed_texts([query_text])[0], dtype=np.float32)

    chunk_ids, vectors = mgr.get_active_chunk_vectors()
    chunk_ids, vectors = _authorized_subset(chunk_ids, vectors, tenant_id, principals)
    return _cosine_topk(query_vec, vectors, chunk_ids, k)


def ann_recall_at_k(hnsw_results: list[tuple[str, float]], exhaustive_results: list[tuple[str, float]], k: int) -> float:
    """ANNRecall@k(q) for a single query -- pure function, independently
    testable against a hand-constructed example (Phase 6.4 spec's explicit
    ask: 'verify the recall computation itself with a small controlled
    synthetic example where the answer is known')."""
    if k <= 0:
        return 1.0
    e_ids = {c for c, _ in exhaustive_results[:k]}
    h_ids = {c for c, _ in hnsw_results[:k]}
    return len(e_ids & h_ids) / k


@dataclass
class AnnRecallSummary:
    n_queries: int
    k: int
    mean_ann_recall_at_k: float
    per_query: list[dict] = field(default_factory=list)


def run_ann_recall_eval(
    queries: list[str],
    k: int = 10,
    tenant_id: str | None = "tenant-a",
    principals: list[str] | None = None,
) -> AnnRecallSummary:
    """The actual oracle run against a query set -- O(n_queries * corpus
    size), so callers should pass a representative sample (per the
    blueprint: 10-20% of the corpus or a stratified subset), not
    necessarily every gold query on a large corpus."""
    mgr = search_index.get_index_manager()
    per_query = []
    for q in queries:
        hnsw_results = mgr.search(q, k=k, tenant_id=tenant_id, principals=principals)
        exhaustive_results = exhaustive_knn(q, k=k, tenant_id=tenant_id, principals=principals)
        recall = ann_recall_at_k(hnsw_results, exhaustive_results, k)
        per_query.append(
            {
                "query": q,
                "ann_recall_at_k": recall,
                "hnsw_top": [c for c, _ in hnsw_results[:k]],
                "exhaustive_top": [c for c, _ in exhaustive_results[:k]],
            }
        )
    n = len(per_query)
    mean_recall = sum(p["ann_recall_at_k"] for p in per_query) / n if n else 0.0
    return AnnRecallSummary(n_queries=n, k=k, mean_ann_recall_at_k=mean_recall, per_query=per_query)
