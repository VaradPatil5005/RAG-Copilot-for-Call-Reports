"""Hybrid retrieval engine -- local substitute for Azure AI Search's
BM25 + HNSW + RRF + semantic reranker (see docs/decisions/0003).

Components, each isolated so a real Azure AI Search adapter can replace
this whole module later without touching callers (routers/retrieval.py):

  - Lexical:  SQLite FTS5 virtual table `chunks_fts`, kept in the same DB
              file as `chunks` and synced automatically via triggers
              (db.py) -- no separate index file to keep in sync.
  - Vector:   hnswlib HNSW index, persisted to disk per index version
              under apps/api/data/index/<name>/, mirroring the blueprint's
              blue/green indexing concept even at local-dev scale.
  - Fusion:   Reciprocal Rank Fusion, implemented directly (this is just
              math, not a "substitute" -- same formula the real Azure
              hybrid query would apply).
  - Rerank:   fastembed's TextCrossEncoder (ONNX, same runtime as
              embeddings -- see ADR 0004), applied to the top RRF-fused
              candidates.
  - Parent-child expansion + result diversification: implemented directly
    against the `chunks` table's `parent_section_id` / `document_id`.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import hnswlib
import numpy as np

from app import db
from app.services import embeddings

logger = logging.getLogger("retrieval.search_index")

INDEX_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "index"
DEFAULT_INDEX_NAME = "callreports-v1"
ACTIVE_INDEX_KEY = "active_index"

# HNSW config -- blueprint's recommended initial production configuration
# (Section 6 / "Recommended initial configuration"). These are starting
# values, not universally optimal -- see the blueprint's offline grid-search
# procedure for how to tune them against a real gold benchmark.
HNSW_M = 8
HNSW_EF_CONSTRUCTION = 800
HNSW_EF_SEARCH = 500
HNSW_METRIC = "cosine"
INITIAL_CAPACITY = 1000

RRF_K = 60
RETRIEVAL_CANDIDATES = 75  # 50-100 before reranking, per blueprint
RERANK_INPUT = 40  # top ~30-50 RRF-fused candidates sent to the reranker
FINAL_CONTEXT_MIN = 8
FINAL_CONTEXT_MAX = 15
DEFAULT_MAX_PER_DOCUMENT = 4
DEFAULT_MAX_PER_SECTION = 2
CONTEXT_TOKEN_BUDGET = 6000  # ceiling for parent-child expansion


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Vector index (hnswlib)
# --------------------------------------------------------------------------


class IndexManager:
    """Owns one on-disk HNSW index (vectors + a chunk_id<->label map)."""

    def __init__(self, name: str = DEFAULT_INDEX_NAME) -> None:
        self.name = name
        self.dir = INDEX_ROOT / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._provider = embeddings.get_default_provider()
        self._dims = self._provider.dimensions
        self._index: hnswlib.Index | None = None
        self._id_map: dict[str, Any] = {"chunk_to_label": {}, "label_to_meta": {}, "next_label": 0}
        self._capacity = INITIAL_CAPACITY
        self._load_or_init()

    # -- persistence ------------------------------------------------------
    @property
    def _index_path(self) -> Path:
        return self.dir / "index.bin"

    @property
    def _map_path(self) -> Path:
        return self.dir / "id_map.json"

    @property
    def _meta_path(self) -> Path:
        return self.dir / "meta.json"

    def _load_or_init(self) -> None:
        self._index = hnswlib.Index(space=HNSW_METRIC, dim=self._dims)
        if self._index_path.exists() and self._map_path.exists():
            try:
                self._id_map = json.loads(self._map_path.read_text())
                self._capacity = max(INITIAL_CAPACITY, self._id_map.get("next_label", 0) + 1)
                self._index.load_index(str(self._index_path), max_elements=self._capacity)
                self._index.set_ef(HNSW_EF_SEARCH)
                logger.info(
                    "Loaded vector index %r: %d vectors, dim=%d", self.name, self._index.get_current_count(), self._dims
                )
                return
            except Exception:  # noqa: BLE001
                logger.exception("Failed to load existing index %r -- reinitializing", self.name)

        self._index.init_index(max_elements=self._capacity, ef_construction=HNSW_EF_CONSTRUCTION, M=HNSW_M)
        self._index.set_ef(HNSW_EF_SEARCH)
        self._id_map = {"chunk_to_label": {}, "label_to_meta": {}, "next_label": 0}
        self._persist(meta_only=False)

    def _persist(self, meta_only: bool = True) -> None:
        if not meta_only and self._index is not None:
            self._index.save_index(str(self._index_path))
        self._map_path.write_text(json.dumps(self._id_map))
        self._meta_path.write_text(
            json.dumps(
                {
                    "name": self.name,
                    "dimensions": self._dims,
                    "embedding_model": self._provider.model_name,
                    "embedding_is_fallback": embeddings.provider_is_fallback(),
                    "metric": HNSW_METRIC,
                    "m": HNSW_M,
                    "ef_construction": HNSW_EF_CONSTRUCTION,
                    "ef_search": HNSW_EF_SEARCH,
                    "count": self._index.get_current_count() if self._index else 0,
                    "updated_at": _now(),
                }
            )
        )
        # Phase 6.5 (blue/green indexing): do NOT unconditionally flip the
        # active-index alias on every save -- that would defeat blue/green
        # entirely, since a brand-new index version under construction
        # would become "active" the moment its first batch is written,
        # mid-build, before it's validated. Only set the alias here if no
        # active index has ever been chosen yet (the very first index in a
        # fresh deployment bootstraps itself as active); switching between
        # existing, already-built versions is `switch_active_index`'s job
        # alone -- see that function and `rebuild_index_blue_green`.
        with db.tx() as conn:
            conn.execute(
                "INSERT INTO search_index_meta (key, value, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(key) DO NOTHING",
                (ACTIVE_INDEX_KEY, self.name, _now()),
            )

    def _ensure_capacity(self, extra: int) -> None:
        needed = self._id_map["next_label"] + extra
        if needed > self._capacity:
            self._capacity = max(needed, int(self._capacity * 1.5) + 1)
            self._index.resize_index(self._capacity)

    # -- mutation -----------------------------------------------------------
    def delete_document(self, document_id: str, version: int) -> None:
        """Marks every vector belonging to this document/version deleted
        (hnswlib excludes marked-deleted points from search automatically).
        Called before re-adding on reprocessing so labels never leak stale
        vectors into results."""
        with self._lock:
            to_remove = [
                (chunk_id, label)
                for chunk_id, label in list(self._id_map["chunk_to_label"].items())
                if self._id_map["label_to_meta"].get(str(label), {}).get("document_id") == document_id
                and self._id_map["label_to_meta"].get(str(label), {}).get("version") == version
            ]
            for chunk_id, label in to_remove:
                try:
                    self._index.mark_deleted(int(label))
                except RuntimeError:
                    pass  # already deleted
                del self._id_map["chunk_to_label"][chunk_id]
                self._id_map["label_to_meta"].pop(str(label), None)
            if to_remove:
                self._persist(meta_only=False)

    def upsert_chunks(self, chunks: list[dict[str, Any]]) -> int:
        """Embeds (batched, content-hash cached) and adds/updates vectors
        for the given chunk rows. Returns the number of vectors written."""
        if not chunks:
            return 0
        with self._lock:
            texts_by_hash = {c["content_hash"]: c["content"] for c in chunks}
            vectors_by_hash = embeddings.embed_with_cache(texts_by_hash)

            self._ensure_capacity(len(chunks))
            labels = []
            vectors = []
            for c in chunks:
                label = self._id_map["next_label"]
                self._id_map["next_label"] += 1
                self._id_map["chunk_to_label"][c["chunk_id"]] = label
                self._id_map["label_to_meta"][str(label)] = {
                    "chunk_id": c["chunk_id"],
                    "document_id": c["document_id"],
                    "version": c["version"],
                }
                labels.append(label)
                vectors.append(vectors_by_hash[c["content_hash"]])

            self._index.add_items(vectors, labels)
            self._persist(meta_only=False)
            return len(chunks)

    # -- query --------------------------------------------------------------
    def search(
        self,
        query_text: str,
        k: int,
        tenant_id: str | None = None,
        principals: list[str] | None = None,
    ) -> list[tuple[str, float]]:
        """Returns [(chunk_id, similarity)] best-first. Similarity is
        1 - cosine_distance (higher is better).

        Phase 6.3: hnswlib itself has no native metadata-filtered ANN
        (unlike Azure AI Search's `vectorFilterMode: preFilter`, which
        skips non-matching nodes during graph traversal) -- documented
        limitation, see ADR 0007. The closest honest equivalent at this
        library's capability level: candidate labels come back from the
        ANN search as usual, but resolving them to chunk_ids is itself a
        single ACL-predicated SQL query (`db.acl_predicate_sql`), so an
        unauthorized chunk_id is never present in the returned list at
        all -- it cannot reach fusion, reranking, or generation. This is
        still enforced *before* any evidence object is built, which is
        the property that matters; only the internal ANN distance
        computation (not the result set) still touches unauthorized
        vectors."""
        # Clamp k against the number of *active* (non-deleted) points, not
        # hnswlib's get_current_count() -- that count includes points
        # mark_deleted by delete_document() (e.g. after a reprocess), and
        # asking hnswlib for more neighbors than currently exist among the
        # non-deleted set raises "Cannot return the results in a contiguous
        # 2D array" rather than silently truncating.
        active_count = len(self._id_map["chunk_to_label"])
        if active_count == 0:
            return []
        provider = self._provider
        query_vec = provider.embed_texts([query_text])[0]
        k = min(k, active_count)
        with self._lock:
            labels, distances = self._index.knn_query(query_vec, k=k)
        candidates: list[tuple[str, float]] = []
        for label, dist in zip(labels[0], distances[0]):
            meta = self._id_map["label_to_meta"].get(str(int(label)))
            if not meta:
                continue
            candidates.append((meta["chunk_id"], 1.0 - float(dist)))

        if tenant_id is None and principals is None:
            return candidates
        chunk_ids = [c for c, _ in candidates]
        if not chunk_ids:
            return []
        conn = db.get_connection()
        placeholders = ",".join("?" for _ in chunk_ids)
        sql = f"SELECT chunk_id FROM chunks WHERE chunk_id IN ({placeholders})"
        params: list[Any] = list(chunk_ids)
        if tenant_id:
            sql += " AND tenant_id = ?"
            params.append(tenant_id)
        acl_sql, acl_params = db.acl_predicate_sql(principals)
        if acl_sql:
            sql += f" AND {acl_sql}"
            params.extend(acl_params)
        authorized = {r["chunk_id"] for r in conn.execute(sql, params).fetchall()}
        return [(cid, score) for cid, score in candidates if cid in authorized]

    def get_active_chunk_vectors(self) -> tuple[list[str], np.ndarray]:
        """Phase 6.4: every currently-active chunk_id and its stored
        embedding vector, straight from hnswlib's own storage
        (`get_items`, which returns the exact full-precision vectors as
        originally inserted, not an approximation of them) -- the raw
        material for the exhaustive-KNN recall oracle in
        `app/evaluation/ann_recall.py`. Not used anywhere on the query
        path; this is an evaluation-only accessor."""
        chunk_to_label = self._id_map["chunk_to_label"]
        if not chunk_to_label:
            return [], np.zeros((0, self._dims), dtype=np.float32)
        chunk_ids = list(chunk_to_label.keys())
        labels = [chunk_to_label[c] for c in chunk_ids]
        with self._lock:
            vectors = np.array(self._index.get_items(labels), dtype=np.float32)
        return chunk_ids, vectors


_index_manager: IndexManager | None = None
_index_manager_lock = threading.Lock()


def get_index_manager() -> IndexManager:
    global _index_manager
    with _index_manager_lock:
        if _index_manager is None:
            active = db.row_to_dict(
                db.get_connection()
                .execute("SELECT value FROM search_index_meta WHERE key = ?", (ACTIVE_INDEX_KEY,))
                .fetchone()
            )
            name = active["value"] if active else DEFAULT_INDEX_NAME
            _index_manager = IndexManager(name)
        return _index_manager


def index_document(document_id: str, version: int) -> int:
    """Called by the pipeline after chunks are persisted. (Re)builds the
    vector index entries for this document/version. Lexical (FTS5) indexing
    already happened via the `chunks` table insert triggers."""
    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute(
            "SELECT chunk_id, document_id, version, content, content_hash FROM chunks "
            "WHERE document_id = ? AND version = ?",
            (document_id, version),
        ).fetchall()
    )
    mgr = get_index_manager()
    mgr.delete_document(document_id, version)
    return mgr.upsert_chunks(rows)


def rebuild_index() -> int:
    """Legacy full rebuild -- kept for compatibility, but now implemented
    in terms of blue/green underneath (see `rebuild_index_blue_green`)
    rather than deleting the active index's files before the replacement
    is ready. Returns the vector count of the new (now-active) index."""
    result = rebuild_index_blue_green()
    return result["new_count"]


def _index_version_names() -> list[str]:
    if not INDEX_ROOT.exists():
        return []
    return sorted(p.name for p in INDEX_ROOT.iterdir() if p.is_dir())


def _next_index_name() -> str:
    """callreports-v1 -> callreports-v2, etc., based on existing on-disk
    index versions -- never reuses a name, so an old version's files are
    never at risk of being silently overwritten by a new build."""
    versions = []
    for name in _index_version_names():
        m = re.match(r"^callreports-v(\d+)$", name)
        if m:
            versions.append(int(m.group(1)))
    return f"callreports-v{(max(versions) + 1) if versions else 1}"


def build_new_index_version() -> tuple[str, int]:
    """Phase 6.5 blue/green reindex, step 1: builds a brand-new hnswlib
    index under a fresh version name from `chunks` (the source of truth)
    while the currently-active index keeps serving every live request,
    completely unaffected -- no existing index file is touched, let alone
    deleted. Returns (new_name, vector_count); the new version is NOT
    active until `switch_active_index` is called on it."""
    new_name = _next_index_name()
    new_mgr = IndexManager(new_name)
    conn = db.get_connection()
    rows = db.rows_to_list(conn.execute("SELECT DISTINCT document_id, version FROM chunks").fetchall())
    total = 0
    for r in rows:
        chunk_rows = db.rows_to_list(
            conn.execute(
                "SELECT chunk_id, document_id, version, content, content_hash FROM chunks "
                "WHERE document_id = ? AND version = ?",
                (r["document_id"], r["version"]),
            ).fetchall()
        )
        total += new_mgr.upsert_chunks(chunk_rows)
    logger.info("Built new index version %r with %d vectors (not yet active)", new_name, total)
    return new_name, total


def switch_active_index(name: str) -> None:
    """Phase 6.5 blue/green reindex, step 2 (the actual "alias switch"):
    a single atomic UPDATE to `search_index_meta`, then invalidates this
    process's cached `IndexManager` singleton so the *next* request loads
    the newly-active index. Also used to roll back: calling this again
    with the previous version's name is the entire rollback procedure,
    since that version's files were never deleted.

    Known limitation (documented, not silently ignored): this invalidates
    the singleton in *this* process only. A real multi-worker/multi-
    replica deployment needs a cross-process invalidation signal (a
    lightweight pub/sub, or each worker polling `search_index_meta`'s
    `updated_at`) so every replica picks up the switch -- tracked as a
    Phase 6.5 gap in ADR 0007, not solved here."""
    global _index_manager
    if name not in _index_version_names():
        raise ValueError(f"Index version {name!r} does not exist on disk under {INDEX_ROOT}")
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO search_index_meta (key, value, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (ACTIVE_INDEX_KEY, name, _now()),
        )
    with _index_manager_lock:
        _index_manager = None


def get_active_index_name() -> str:
    active = db.row_to_dict(
        db.get_connection().execute("SELECT value FROM search_index_meta WHERE key = ?", (ACTIVE_INDEX_KEY,)).fetchone()
    )
    return active["value"] if active else DEFAULT_INDEX_NAME


def list_index_versions() -> list[dict]:
    """Every index version currently on disk, its vector count, and
    whether it's the active one -- surfaced in the Admin panel (Phase
    6.6) and used by the disaster-recovery drill (Phase 6.5) to confirm a
    rebuild actually produced a healthy replacement before switching."""
    active_name = get_active_index_name()
    out = []
    for name in _index_version_names():
        meta_path = INDEX_ROOT / name / "meta.json"
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
            except (OSError, json.JSONDecodeError):
                meta = {}
        out.append(
            {
                "name": name,
                "is_active": name == active_name,
                "vector_count": meta.get("count"),
                "updated_at": meta.get("updated_at"),
            }
        )
    return out


def rebuild_index_blue_green() -> dict:
    """The actual Phase 6.5 operation: build a new index version from
    `chunks` while the old one keeps serving, then switch. Returns the
    before/after state so a caller (the reindex endpoint, a test, a DR
    drill) can confirm the new version is healthy before -- or instead
    of -- relying on the switch alone."""
    old_name = get_active_index_name()
    new_name, new_count = build_new_index_version()
    switch_active_index(new_name)
    return {"old_active": old_name, "new_active": new_name, "new_count": new_count}


def rollback_active_index(to_name: str) -> dict:
    """Rollback -- switches back to a previously-active version. Only
    possible because blue/green never deletes an old version's files;
    this fails loudly (`ValueError` from `switch_active_index`) if that
    version was manually removed from disk."""
    old_name = get_active_index_name()
    switch_active_index(to_name)
    return {"rolled_back_from": old_name, "rolled_back_to": to_name}


# --------------------------------------------------------------------------
# Lexical search (FTS5 / BM25)
# --------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _fts_query(query_text: str) -> str | None:
    tokens = _TOKEN_RE.findall(query_text)
    if not tokens:
        return None
    return " OR ".join(f'"{t}"' for t in tokens)


def lexical_search(
    query_text: str, k: int, tenant_id: str | None = None, principals: list[str] | None = None
) -> list[tuple[str, float]]:
    """Returns [(chunk_id, bm25_score)] best-first (bm25() is ascending =
    better in SQLite FTS5, so scores here are already negated to
    higher-is-better for consistency with vector similarity).

    Phase 6.3: the ACL predicate (when `principals` is not None) is part
    of this SQL query's WHERE clause -- an unauthorized chunk is excluded
    by FTS5/SQLite itself, at candidate-generation time, not filtered out
    of a Python list afterward."""
    fts_q = _fts_query(query_text)
    if fts_q is None:
        return []
    conn = db.get_connection()
    sql = (
        "SELECT c.chunk_id, bm25(chunks_fts) AS score FROM chunks_fts "
        "JOIN chunks c ON c.rowid = chunks_fts.rowid "
        "WHERE chunks_fts MATCH ?"
    )
    params: list[Any] = [fts_q]
    if tenant_id:
        sql += " AND c.tenant_id = ?"
        params.append(tenant_id)
    acl_sql, acl_params = db.acl_predicate_sql(principals, table_alias="c")
    if acl_sql:
        sql += f" AND {acl_sql}"
        params.extend(acl_params)
    sql += " ORDER BY score ASC LIMIT ?"
    params.append(k)
    try:
        rows = conn.execute(sql, params).fetchall()
    except Exception:  # noqa: BLE001
        logger.exception("FTS5 query failed for %r", query_text)
        return []
    return [(r["chunk_id"], -float(r["score"])) for r in rows]


# --------------------------------------------------------------------------
# Reciprocal Rank Fusion
# --------------------------------------------------------------------------


def reciprocal_rank_fusion(
    ranked_lists: list[list[str]], k: int = RRF_K, weights: list[float] | None = None
) -> list[tuple[str, float]]:
    """RRF(d) = sum_i w_i / (K + rank_i(d)). Missing documents contribute 0
    for that list. Returns [(chunk_id, rrf_score)] sorted best-first."""
    weights = weights or [1.0] * len(ranked_lists)
    scores: dict[str, float] = {}
    for w, ranked in zip(weights, ranked_lists):
        for rank, chunk_id in enumerate(ranked, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + w / (k + rank)
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)


# --------------------------------------------------------------------------
# Reranking
# --------------------------------------------------------------------------


class _RerankerUnavailable(Exception):
    pass


_reranker = None
_reranker_lock = threading.Lock()
_reranker_is_fallback = False


def _get_reranker():
    """Lazily loads fastembed's TextCrossEncoder. Same network constraint
    as embeddings (see ADR 0004): falls back to a lexical-overlap scorer if
    the ONNX weights can't be downloaded, logged loudly, never silent."""
    global _reranker, _reranker_is_fallback
    with _reranker_lock:
        if _reranker is not None:
            return _reranker
        try:
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            _reranker = TextCrossEncoder(model_name=embeddings.RERANK_MODEL_NAME)
            _reranker_is_fallback = False
            logger.info("Reranker: fastembed TextCrossEncoder (%s)", embeddings.RERANK_MODEL_NAME)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "fastembed reranker model download failed (%s) -- falling back to a "
                "lexical-overlap reranker. Local-sandbox degrade only; see ADR 0004.",
                exc,
            )
            _reranker = _RerankerUnavailable()
            _reranker_is_fallback = True
        return _reranker


def reranker_is_fallback() -> bool:
    _get_reranker()
    return _reranker_is_fallback


def _lexical_overlap_score(query: str, doc: str) -> float:
    q_tokens = set(t.lower() for t in _TOKEN_RE.findall(query))
    d_tokens = _TOKEN_RE.findall(doc.lower())
    if not q_tokens or not d_tokens:
        return 0.0
    d_counts: dict[str, int] = {}
    for t in d_tokens:
        d_counts[t] = d_counts.get(t, 0) + 1
    overlap = sum(d_counts.get(t, 0) for t in q_tokens)
    return overlap / math_sqrt(len(d_tokens))


def math_sqrt(x: float) -> float:
    import math

    return math.sqrt(max(x, 1))


def rerank(query: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Applies the cross-encoder to `candidates` (each needs a "content"
    field) and returns them re-sorted with a "rerank_score" attached."""
    if not candidates:
        return candidates
    reranker = _get_reranker()
    if isinstance(reranker, _RerankerUnavailable):
        for c in candidates:
            c["rerank_score"] = _lexical_overlap_score(query, c["content"])
    else:
        scores = list(reranker.rerank(query, [c["content"] for c in candidates]))
        for c, s in zip(candidates, scores):
            c["rerank_score"] = float(s)
    candidates.sort(key=lambda c: c["rerank_score"], reverse=True)
    return candidates


# --------------------------------------------------------------------------
# Diversification + parent-child expansion
# --------------------------------------------------------------------------


def diversify(
    results: list[dict[str, Any]],
    max_per_document: int = DEFAULT_MAX_PER_DOCUMENT,
    max_per_section: int = DEFAULT_MAX_PER_SECTION,
) -> list[dict[str, Any]]:
    """Caps results per document and per section so near-duplicate chunks
    from one page don't crowd out other relevant documents. Tunable because
    it can hurt recall for questions genuinely concentrated in one report."""
    out = []
    doc_counts: dict[str, int] = {}
    section_counts: dict[str, int] = {}
    for item in results:
        doc = item["document_id"]
        section = item.get("parent_section_id") or ""
        if doc_counts.get(doc, 0) >= max_per_document:
            continue
        if section and section_counts.get(section, 0) >= max_per_section:
            continue
        out.append(item)
        doc_counts[doc] = doc_counts.get(doc, 0) + 1
        if section:
            section_counts[section] = section_counts.get(section, 0) + 1
    return out


def expand_parent_child(
    selected: list[dict[str, Any]],
    token_budget: int = CONTEXT_TOKEN_BUDGET,
    principals: list[str] | None = None,
) -> list[dict[str, Any]]:
    """For each selected chunk, pulls in immediately adjacent sibling
    chunks (same parent_section_id) if there's still token budget, so an
    isolated passage doesn't lose surrounding qualification/negation. Marks
    expansion chunks with is_expansion=True and does not re-rank them.

    Phase 6.3: the ACL predicate is part of the sibling-fetch SQL query
    itself (`db.acl_predicate_sql`), same chokepoint as `_fetch_chunk_rows`
    -- an unauthorized sibling is excluded by the query, not by a Python
    check after fetching it."""
    conn = db.get_connection()
    selected_ids = {c["chunk_id"] for c in selected}
    used_tokens = sum(c.get("token_count") or 0 for c in selected)
    expanded = list(selected)

    section_ids = {c.get("parent_section_id") for c in selected if c.get("parent_section_id")}
    if not section_ids:
        return expanded

    placeholders = ",".join("?" for _ in section_ids)
    sql = (
        f"SELECT chunk_id, document_id, version, tenant_id, parent_section_id, chunk_type, "
        f"section_path, page_number, customer_name, meeting_date, content, raw_text, "
        f"table_json, table_id, token_count, acl_principals, classification FROM chunks "
        f"WHERE parent_section_id IN ({placeholders})"
    )
    params: list[Any] = list(section_ids)
    acl_sql, acl_params = db.acl_predicate_sql(principals)
    if acl_sql:
        sql += f" AND {acl_sql}"
        params.extend(acl_params)
    sql += " ORDER BY parent_section_id, chunk_id"
    siblings = db.rows_to_list(conn.execute(sql, params).fetchall())
    by_section: dict[str, list[dict[str, Any]]] = {}
    for s in siblings:
        by_section.setdefault(s["parent_section_id"], []).append(s)

    for c in selected:
        section = c.get("parent_section_id")
        if not section:
            continue
        group = by_section.get(section, [])
        idx = next((i for i, g in enumerate(group) if g["chunk_id"] == c["chunk_id"]), None)
        if idx is None:
            continue
        for neighbor_idx in (idx - 1, idx + 1):
            if neighbor_idx < 0 or neighbor_idx >= len(group):
                continue
            neighbor = group[neighbor_idx]
            if neighbor["chunk_id"] in selected_ids:
                continue
            # No Python ACL check needed here -- `siblings` was already
            # ACL-filtered by the SQL query above.
            n_tokens = neighbor.get("token_count") or 0
            if used_tokens + n_tokens > token_budget:
                continue
            neighbor = dict(neighbor)
            neighbor["section_path"] = db.loads(neighbor.get("section_path"), [])
            neighbor["table_json"] = db.loads(neighbor.get("table_json"))
            neighbor["is_expansion"] = True
            expanded.append(neighbor)
            selected_ids.add(neighbor["chunk_id"])
            used_tokens += n_tokens

    return expanded


# --------------------------------------------------------------------------
# Full hybrid pipeline
# --------------------------------------------------------------------------


@dataclass
class SearchFilters:
    customer: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    document_id: str | None = None
    tenant_id: str = "tenant-a"
    # Phase 6.3: the *authenticated* caller's principals, resolved
    # server-side by `services/auth.py` from a verified JWT -- never a
    # client-supplied request field (see ADR 0006 for what this replaced,
    # ADR 0007 for the migration). None means "no ACL enforcement" -- used
    # only by internal/system callers (e.g. the evaluation harness) that
    # already scope by tenant_id alone, never by an end-user request.
    # When set, enforcement happens as a real SQL predicate at every
    # retrieval stage (see db.acl_predicate_sql), not a Python post-fetch
    # filter -- an unauthorized chunk is never constructed as a row at
    # all, let alone returned as evidence.
    principals: list[str] | None = None


@dataclass
class RetrievalTrace:
    query: str
    filters: dict[str, Any]
    bm25_candidate_count: int = 0
    vector_candidate_count: int = 0
    fused_candidate_count: int = 0
    reranked_count: int = 0
    diversified_count: int = 0
    final_count: int = 0
    embedding_provider: str = ""
    reranker_provider: str = ""
    final_chunk_ids: list[str] = field(default_factory=list)


def _fetch_chunk_rows(chunk_ids: list[str], filters: SearchFilters) -> dict[str, dict[str, Any]]:
    """Phase 6.3: the ACL predicate is part of this SQL query's WHERE
    clause (`db.acl_predicate_sql`) -- an unauthorized chunk_id is
    excluded by the query itself and never constructed into a row dict,
    not filtered out of one afterward."""
    if not chunk_ids:
        return {}
    conn = db.get_connection()
    placeholders = ",".join("?" for _ in chunk_ids)
    sql = (
        "SELECT chunk_id, document_id, version, tenant_id, parent_section_id, chunk_type, "
        "section_path, page_number, customer_name, account_owner, meeting_date, content, "
        "raw_text, table_json, table_id, token_count, acl_principals, classification FROM chunks "
        f"WHERE chunk_id IN ({placeholders}) AND tenant_id = ?"
    )
    params: list[Any] = list(chunk_ids) + [filters.tenant_id]
    if filters.customer:
        sql += " AND customer_name LIKE ?"
        params.append(f"%{filters.customer}%")
    if filters.document_id:
        sql += " AND document_id = ?"
        params.append(filters.document_id)
    if filters.date_from:
        sql += " AND (meeting_date IS NULL OR meeting_date >= ?)"
        params.append(filters.date_from)
    if filters.date_to:
        sql += " AND (meeting_date IS NULL OR meeting_date <= ?)"
        params.append(filters.date_to)
    acl_sql, acl_params = db.acl_predicate_sql(filters.principals)
    if acl_sql:
        sql += f" AND {acl_sql}"
        params.extend(acl_params)
    rows = db.rows_to_list(conn.execute(sql, params).fetchall())
    out = {}
    for r in rows:
        r["section_path"] = db.loads(r.get("section_path"), [])
        r["table_json"] = db.loads(r.get("table_json"))
        r["acl_principals"] = db.loads(r.get("acl_principals"), [])
        out[r["chunk_id"]] = r
    return out


def hybrid_search(
    query: str,
    top_k: int = 10,
    filters: SearchFilters | None = None,
    max_per_document: int = DEFAULT_MAX_PER_DOCUMENT,
    max_per_section: int = DEFAULT_MAX_PER_SECTION,
) -> tuple[list[dict[str, Any]], RetrievalTrace]:
    """Query -> BM25 + vector -> RRF -> rerank -> diversify. Returns ranked
    result dicts (chunk metadata + bm25_score/vector_score/rrf_score/
    rerank_score) plus a trace for logging/debugging."""
    filters = filters or SearchFilters()
    trace = RetrievalTrace(query=query, filters=filters.__dict__)

    bm25_hits = lexical_search(query, RETRIEVAL_CANDIDATES, tenant_id=filters.tenant_id, principals=filters.principals)
    trace.bm25_candidate_count = len(bm25_hits)

    mgr = get_index_manager()
    vector_hits = mgr.search(query, RETRIEVAL_CANDIDATES, tenant_id=filters.tenant_id, principals=filters.principals)
    trace.vector_candidate_count = len(vector_hits)

    bm25_ids = [c for c, _ in bm25_hits]
    vector_ids = [c for c, _ in vector_hits]
    fused = reciprocal_rank_fusion([bm25_ids, vector_ids])
    trace.fused_candidate_count = len(fused)

    fused_top = fused[:RERANK_INPUT]
    fused_ids = [c for c, _ in fused_top]
    rows_by_id = _fetch_chunk_rows(fused_ids, filters)

    bm25_score_by_id = dict(bm25_hits)
    vector_score_by_id = dict(vector_hits)
    rrf_score_by_id = dict(fused_top)

    candidates = []
    for chunk_id in fused_ids:
        row = rows_by_id.get(chunk_id)
        if not row:
            continue  # filtered out by tenant/customer/date filters
        row = dict(row)
        row["bm25_score"] = bm25_score_by_id.get(chunk_id)
        row["vector_score"] = vector_score_by_id.get(chunk_id)
        row["rrf_score"] = rrf_score_by_id.get(chunk_id)
        candidates.append(row)

    reranked = rerank(query, candidates)

    # Phase E (Self-Learning Decision Intelligence Copilot, additive):
    # Apply learned chunk utility multipliers (bounded [0.70, 1.30]) based
    # on historical verification and human feedback.
    try:
        from app.services import learning

        utility_map = learning.get_chunk_utility_multipliers([c["chunk_id"] for c in reranked])
        for c in reranked:
            mult = utility_map.get(c["chunk_id"], 1.0)
            c["utility_multiplier"] = mult
            c["raw_rerank_score"] = c.get("rerank_score", 0.0)
            c["rerank_score"] = c["raw_rerank_score"] * mult
        reranked.sort(key=lambda c: c["rerank_score"], reverse=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to apply chunk utility multipliers (non-fatal): %s", exc)

    trace.reranked_count = len(reranked)
    trace.reranker_provider = "fastembed" if not reranker_is_fallback() else "lexical-overlap-fallback"
    trace.embedding_provider = "fastembed" if not embeddings.provider_is_fallback() else "hashing-fallback"

    diversified = diversify(reranked, max_per_document, max_per_section)
    trace.diversified_count = len(diversified)

    final_k = max(FINAL_CONTEXT_MIN, min(top_k, FINAL_CONTEXT_MAX))
    final = diversified[:final_k]
    trace.final_count = len(final)
    trace.final_chunk_ids = [c["chunk_id"] for c in final]

    logger.info(
        "hybrid_search query=%r bm25=%d vector=%d fused=%d reranked=%d final=%d",
        query,
        trace.bm25_candidate_count,
        trace.vector_candidate_count,
        trace.fused_candidate_count,
        trace.reranked_count,
        trace.final_count,
    )
    return final, trace


def structured_table_search(
    filters: SearchFilters,
    row_contains: str | None = None,
    limit: int = 25,
) -> list[dict[str, Any]]:
    """Table-aware structured retrieval (blueprint Section 4.2 / 4.4): for
    questions like "show all reports where pipeline exceeded $1M", exact
    filters on table rows beat semantic ranking. Queries `chunk_type='table'`
    chunks directly (bypassing BM25/vector/RRF) with the same tenant/ACL/
    customer/date filters as hybrid_search, then does a substring match over
    each table's flattened `table_json` rows for `row_contains`. This is a
    local stand-in for Azure AI Search's normalized structured `table_json`
    fields (blueprint's `customer/metric/value/currency/period` schema) —
    exact numeric comparisons (>, <) would need those fields to be columns,
    which is future work once the table schema is standardized per-report."""
    conn = db.get_connection()
    sql = (
        "SELECT chunk_id, document_id, version, tenant_id, parent_section_id, chunk_type, "
        "section_path, page_number, customer_name, account_owner, meeting_date, content, "
        "raw_text, table_json, table_id, token_count, acl_principals, classification FROM chunks "
        "WHERE chunk_type = 'table' AND tenant_id = ?"
    )
    params: list[Any] = [filters.tenant_id]
    if filters.customer:
        sql += " AND customer_name LIKE ?"
        params.append(f"%{filters.customer}%")
    if filters.document_id:
        sql += " AND document_id = ?"
        params.append(filters.document_id)
    if filters.date_from:
        sql += " AND (meeting_date IS NULL OR meeting_date >= ?)"
        params.append(filters.date_from)
    if filters.date_to:
        sql += " AND (meeting_date IS NULL OR meeting_date <= ?)"
        params.append(filters.date_to)
    rows = db.rows_to_list(conn.execute(sql, params).fetchall())
    out = []
    for r in rows:
        acl = db.loads(r.get("acl_principals"), [])
        classification = (r.get("classification") or "internal").lower()
        if filters.principals is not None and classification != "public" and not (set(acl) & set(filters.principals)):
            continue
        if row_contains and row_contains.lower() not in (r.get("content") or "").lower():
            continue
        r["section_path"] = db.loads(r.get("section_path"), [])
        r["table_json"] = db.loads(r.get("table_json"))
        r["acl_principals"] = acl
        out.append(r)
        if len(out) >= limit:
            break
    return out


def retrieve_context(
    query: str,
    top_k: int = 10,
    filters: SearchFilters | None = None,
) -> tuple[list[dict[str, Any]], RetrievalTrace]:
    """Same as hybrid_search but also applies parent-child expansion --
    this is what Phase 4's Copilot will consume directly."""
    results, trace = hybrid_search(query, top_k, filters)
    expanded = expand_parent_child(results, principals=(filters.principals if filters else None))
    trace.final_chunk_ids = [c["chunk_id"] for c in expanded]
    return expanded, trace
