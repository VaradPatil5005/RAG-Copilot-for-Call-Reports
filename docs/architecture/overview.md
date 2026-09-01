# Architecture Overview — Enterprise RAG Copilot (as actually built)

This document reflects the system as it exists after Phase 6, not the
original blueprint plan. It mirrors `docs/decisions/0001` through `0007`
into one coherent picture; where this document and an ADR disagree, the
ADR is more detailed and should be treated as authoritative.

**Read `docs/decisions/0007-phase6-graphrag-security-eval.md`'s
"Verification status" section before trusting any of this as measured
behavior** — Phase 6 was built without a networked environment to
install dependencies or run the test suite. Everything below describes
what the code does, not a confirmed, executed result.

## 1. Request-time architecture

```
                         Browser (Next.js app)
                                  |
                     Bearer JWT (services/auth.py)
                                  |
                                  v
+-------------------------------------------------------------------+
|                        FastAPI (apps/api)                          |
|                                                                     |
|  /documents/*     upload, list, get, patch, reprocess               |
|  /search           hybrid BM25 + vector + RRF + rerank               |
|  /retrieval         same, + parent-child expansion + table lookup     |
|  /chat              intent classify -> agentic retrieval -> generate  |
|                      -> citation validate -> stream SSE                |
|  /graph/query        GraphRAG traversal, ACL-filtered, cited            |
|  /evaluation/*        gold sets, retrieval eval, full benchmark          |
|  /system/*             health, metrics, audit, admin overview            |
|  /auth/*                 dev-token issuance (local stand-in for an IdP)   |
+-------------------------------------------------------------------+
        |            |              |              |            |
        v            v              v              v            v
   SQLite DB    hnswlib index   FTS5 (in DB)   Local filesystem  networkx
   (metadata,   (dense vectors,  (lexical         (raw PDFs +      (in-memory
   chunks,      blue/green      search, trigger-  metadata          graph
   graph_*,     versioned)      synced to         sidecars +        traversal
   audit, ...)                  `chunks`)         derived JSON)     over
                                                                     graph_edges)
```

## 2. Ingestion pipeline (per document version)

```
upload -> validate (signature/malware/dedupe) -> extract (layout, OCR,
tables, figures) -> multimodal routing (low-confidence pages only) ->
normalize -> hierarchical chunk -> embed -> index (FTS5 + hnswlib) ->
graph-extract (entities/relationships) -> manifest written -> completed
```

Every stage is logged to `processing_events` and reflected in
`document_versions.status`/`.stage`, so a stuck or failed document is
diagnosable from the API alone. Multimodal routing and graph extraction
are both non-fatal — a failure there logs an error and continues, it
never fails the whole ingestion.

## 3. Component-by-component summary

| Layer | What it does | Key files | ADR |
|---|---|---|---|
| Storage | Immutable raw PDFs + metadata sidecars; derived JSON manifests | `services/storage.py` | 0001, 0007 |
| Ingestion orchestration | In-process asyncio queue + worker, stage tracking | `services/pipeline.py` | 0002 |
| Extraction | PyMuPDF/pdfplumber layout + OCR + table/figure detection | `services/extraction.py` | 0002 |
| Multimodal | Routes only low-confidence/figure/table pages to vision | `services/multimodal_extraction.py` | 0007 |
| Chunking | Hierarchical parent-child, table/figure-aware | `services/chunking.py` | 0003 |
| Embeddings | `fastembed` (ONNX, `BAAI/bge-small-en-v1.5`), hashing fallback | `services/embeddings.py` | 0004 |
| Lexical index | SQLite FTS5, trigger-synced to `chunks` | `services/search_index.py` | 0003 |
| Vector index | hnswlib, blue/green versioned | `services/search_index.py` | 0003, 0007 |
| Retrieval orchestration | RRF fusion, rerank, diversify, parent-child expansion, query rewrite, bounded agentic loop, temporal analysis | `services/search_index.py`, `services/query_rewrite.py`, `services/agentic_retrieval.py`, `services/temporal.py` | 0003, 0006 |
| GraphRAG | Entity/relationship extraction + relational graph store | `services/graph_extraction.py`, `services/graph_store.py` | 0007 |
| Generation | Pluggable provider (Gemini/Groq/Ollama/extractive fallback), structured JSON, real token usage capture | `services/generation.py` | 0005, 0007 |
| Citation validation | Existence + support check per citation | `services/citation_validator.py` | 0004/0005-era |
| Auth | JWT verification, dev-token issuance for local dev | `services/auth.py` | 0007 |
| ACL enforcement | Real SQL predicate (`json_each`) at every retrieval stage | `db.py`, `services/search_index.py`, `services/graph_store.py` | 0007 |
| Audit | Identity -> ACL filter -> evidence trail | `services/audit.py` | 0007 |
| PII | Detect (flag chunks) + redact (logs/traces only) | `services/pii.py` | 0007 |
| Disaster recovery | Rebuild everything from raw storage + sidecars | `services/disaster_recovery.py` | 0007 |
| Evaluation | Retrieval-only + full (retrieval+generation+citation) benchmarks, 300+ query stratified synthetic set, exhaustive-KNN oracle, HNSW grid search | `evaluation/*.py` | 0006, 0007 |
| Admin | System health, security, cost/usage, evaluation — one aggregation endpoint | `routers/system.py` | 0007 |

## 4. Data model (SQLite, single file)

`documents` / `document_versions` (metadata + processing state) →
`elements` (page-level extraction units, now PII-flagged and
multimodal-description-enriched) → `chunks` (retrieval units, ACL +
classification + PII flags, FTS5-synced) → `chat_traces` (per-answer
trace with token usage) + `access_audit_log` (per-request ACL/evidence
trail) + `graph_nodes`/`graph_edges` (+ `graph_alias_audit`) +
`evaluation_runs` (persisted benchmark reports) + `search_index_meta`
(the blue/green active-alias pointer).

## 5. Security posture, end to end

1. A request presents a bearer JWT (`Authorization: Bearer ...`).
2. `services/auth.py` verifies the signature and expiry, resolving
   `tenant_id` + `principals` — never trusting anything the client puts
   in the request body.
3. Every retrieval path (`search_index.py`'s lexical/vector search,
   `_fetch_chunk_rows`, `expand_parent_child`; `graph_store.py`'s
   predicate/connected/shared-competitor queries) builds a SQL `WHERE`
   predicate from those principals (`db.acl_predicate_sql`) — an
   unauthorized row is excluded by the database engine, not filtered out
   of a Python list after the fact.
4. Generation (`generation.py`) only ever sees evidence that already
   passed step 3; its own system prompt additionally instructs it to
   treat that evidence as untrusted data, not instructions.
5. `citation_validator.py` checks every citation the model produces
   against the *same* authorized evidence set again, post-generation —
   defense in depth, not the primary enforcement point.
6. Every request is logged to `access_audit_log` with the identity, the
   constructed filter, and the evidence chunk_ids actually returned.

The one gap in this chain, stated plainly: hnswlib's ANN search itself
still computes distances against the full vector set before step 3's SQL
filter narrows the *returned* candidates — true production pre-filtering
(Azure AI Search's `vectorFilterMode: preFilter`, which skips
non-matching nodes *during* graph traversal) isn't achievable with this
library without per-tenant sub-indexes. See ADR 0007.

## 6. Cumulative local-dev substitution table

| Target (Azure) | Local substitute | Since |
|---|---|---|
| ADLS Gen2 | Local filesystem, `data/raw` + `data/derived`, with immutable metadata sidecars | 0001, 0007 |
| Event Grid + Service Bus + Durable Functions | In-process `asyncio.Queue` + worker | 0001, 0002 |
| Document Intelligence Layout | PyMuPDF / pdfplumber / pytesseract | 0001, 0002 |
| Azure AI Search (hybrid BM25+HNSW+RRF+semantic) | SQLite FTS5 + hnswlib + in-code RRF + a cross-encoder reranker | 0001, 0003, 0004 |
| Azure OpenAI embeddings | `fastembed` (ONNX, `BAAI/bge-small-en-v1.5`) | 0004 |
| Azure OpenAI GPT-4o Mini | Pluggable provider: Gemini / Groq / Ollama / deterministic extractive fallback | 0001, 0005 |
| GraphRAG store | Relational tables in the same SQLite DB + `networkx` traversal | 0007 |
| Vision model for figures/charts | Gemini native image input, OCR-only fallback | 0007 |
| Enterprise IdP (Azure AD/Entra ID) | JWT verification against a local secret; `/auth/dev-token` stands in for the login flow | 0007 |
| Azure AI Search `vectorFilterMode: preFilter` | SQL-predicated post-ANN-search filtering (documented gap) | 0007 |
| Azure AI Language PII detection | Regex + Luhn-checked local detector | 0007 |
| Key Vault / Managed Identity | `.env`, never committed | 0001, 0007 |
| Azure Monitor / App Insights | `/system/metrics`, `/system/admin/overview`, `access_audit_log` | 0006, 0007 |

## 7. What "production ready" would actually require

Every local substitute above swapped for its real counterpart, **and**
every item in ADR 0007's "Verification status" and "What a real Azure
deployment would need instead" sections actually executed — the HNSW
grid search, the full 300+ query benchmark, the load test, and the
Playwright e2e suite — with their real results replacing every
placeholder in this repository (`docs/load-test-report.md`, the
`/evaluation/run-full` numbers, this document's own claims). Until then,
this is a complete, internally-consistent implementation of the target
architecture's *shape*, verified at the level each phase's own testing
was actually able to reach — not a verified production system.
