# 0003 — Phase 3 Hybrid Retrieval Engine: local substitutions

## Status
Accepted, implemented.

## Context
Phase 3 required turning `elements` (page-level extraction units from
Phase 2) into indexed, searchable, citable evidence: hierarchical
chunking, embeddings, a hybrid lexical+vector index, RRF fusion, semantic
reranking, parent-child context expansion, and `/search` + `/retrieval`
APIs — per the blueprint's Sections 3-7. No Azure AI Search subscription
exists yet (see ADR 0001), so every Azure AI Search capability needed a
local substitute preserving the same behavior contract.

## Decisions

### Lexical index: SQLite FTS5, not `rank-bm25`
ADR 0001 originally sketched `rank-bm25` (in-memory) as the Phase 3
lexical substitute. Implemented instead with a SQLite **FTS5 virtual
table** (`chunks_fts`), for the reason the Phase 3 build prompt calls
out explicitly: it stays in the same DB file as `chunks`, persists
automatically, and needs no separate index file kept in sync by hand.
`chunks_fts` is `content`-linked to `chunks` (`content='chunks'`) and
kept current via `AFTER INSERT/UPDATE/DELETE` triggers in `db.py` — the
lexical index is a side effect of writing to `chunks`, not a separate
build step. Ranking uses FTS5's built-in `bm25()` function (ascending =
better relevance in SQLite's convention; negated in
`search_index.lexical_search` so higher-is-better matches vector
similarity for RRF).

### Vector index: `hnswlib`, not `faiss`
Both were on the table (ADR 0001 left it open). `hnswlib` was chosen
because its `mark_deleted` + `resize_index` API maps directly onto the
pipeline's reprocessing/idempotency model (delete-then-reinsert per
document/version without a full rebuild), and its pure-C++-with-Python-
bindings footprint is lighter to install than `faiss` for this project's
scale (single-digit millions of chunks at 100K+ PDFs, per the blueprint's
capacity estimate). Persisted to disk per index version under
`apps/api/data/index/<name>/` (`index.bin` + `id_map.json` mapping
`chunk_id <-> hnswlib label` + `meta.json`), mirroring the blueprint's
blue/green indexing concept even at local-dev scale. The active index
name is recorded in `search_index_meta` (a one-row-per-key config table,
per the build prompt's "small config table or file" option).

HNSW parameters use the blueprint's recommended initial production
configuration verbatim: `m=8, efConstruction=800, efSearch=500,
metric=cosine`. These are starting values pending the blueprint's offline
grid-search procedure against a real gold benchmark, not derived from
local measurement — local latency/recall numbers are not representative
of Azure AI Search's HNSW implementation (ADR 0001's consequence still
applies).

**Rebuildability**: the on-disk HNSW index is *derived*, not source of
truth — `chunks.content` (plus `content_hash`-cached embeddings) is.
`search_index.rebuild_index()` reconstructs the entire vector index from
`chunks` with no data loss, satisfying the build prompt's constraint that
the vector substitute "must be rebuildable from elements/chunks without
data loss."

### RRF: implemented directly
Not a substitute — Reciprocal Rank Fusion is just math
(`RRF(d) = sum_i 1/(K+rank_i(d))`, `K=60`, missing lists contribute 0).
Implemented for real in `search_index.reciprocal_rank_fusion`, unweighted
by default (equal weight for the BM25 and vector lists), with a `weights`
parameter for future field-specific fusion (e.g. separate table/figure
embedding fields) once offline evaluation justifies it.

### Embeddings and reranking
See ADR 0004 — `fastembed` (ONNX Runtime) for both, chosen deliberately
over `sentence-transformers`/PyTorch, plus why this sandbox specifically
needed a fallback provider to stay testable.

### Chunk security fields, unused until Phase 6
The `chunks` table carries `acl_principals` and `classification` columns
now, per the build prompt's instruction to keep the field structure ready
even though there's no ACL data yet. They are not populated or filtered
on anywhere in Phase 3 — `/search` and `/retrieval` filter only on
`tenant_id`, `customer_name`, `document_id`, and date range. Enforcing
ACLs at retrieval time (never post-generation) is explicit Phase 6 scope
per the blueprint's Section 9 / 15.

## Consequences
- Every substitution lives behind `services/search_index.py` and
  `services/embeddings.py`; `routers/retrieval.py` and any future
  Phase 4 Copilot code call `search_index.hybrid_search` /
  `retrieve_context` without knowing FTS5/hnswlib/fastembed are involved.
  Swapping to real Azure AI Search later means rewriting those two
  service modules, not their callers.
- Local recall/latency numbers from this index are development-velocity
  signals only, not a production SLO measurement — same caveat ADR 0001
  established for extraction quality.
- FTS5's tokenizer is the SQLite default (unicode61) with no stemming or
  synonym expansion — weaker recall than Azure AI Search's lexical
  analyzer for morphological variants. Acceptable for local dev; flagged
  here so it isn't "discovered" later and mistaken for a bug.

## Revisit when
An Azure AI Search resource becomes available — replace
`search_index.py`'s FTS5 lexical query and hnswlib vector query with
Azure AI Search's native hybrid query API (which already does RRF fusion
and semantic ranking server-side), and re-run the Phase 3 exit criteria
against it before claiming retrieval quality numbers are production-
representative.
