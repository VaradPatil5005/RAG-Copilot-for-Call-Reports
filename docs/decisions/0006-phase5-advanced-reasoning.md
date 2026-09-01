# 0006 — Phase 5: Advanced Reasoning

## Status
Accepted, implemented.

## Context
Phase 5 targets the blueprint's and the improvement doc's remaining
"advanced capability" items ahead of GraphRAG/multimodal (explicit Phase 6
scope): query rewriting and entity aliasing (Section 1.1 / priority #2),
bounded agentic retrieval loops (Section 4.1), temporal and contradiction
handling (Section 2.2 / "temporal reasoning" priority), table-aware
structured retrieval (Section 4.2), ACL enforcement at retrieval time
(Section 9/15 / priority #4, pulled forward from Phase 6 because it's cheap
now that `chunks.acl_principals`/`classification` already exist per ADR
0003), and a first evaluation harness + monitoring endpoint (Section 7/13
and Section 4.4, priority #5).

## Decisions

### Query rewriting: rule-based, not a model call
`services/query_rewrite.py` expands company aliases, domain synonyms, and
acronyms from a maintained static table (seeded from the blueprint's own
examples plus this project's Contoso/Globex sample corpus), and classifies
identifier-heavy vs. semantic intent with regex/keyword heuristics. This
matches the project's existing posture (see the Phase 4 intent classifier
in `routers/copilot.py`) of using inspectable rules for retrieval-shaping
control flow rather than an LLM call, which would add latency and a new
failure mode for something that's currently a lookup problem. The
rewritten query is retrieval-only; the *original* query is always what's
shown to the user and passed to generation, so citations never depend on
the rewrite. Extending the alias table only from a maintained list (never
from untrusted document content) is a deliberate prompt-injection
boundary, not an oversight — see blueprint Section 5.

### Bounded agentic retrieval: pass budget in code, not in a prompt
`services/agentic_retrieval.py` runs up to `MAX_PASSES=3` retrieval passes.
Coverage gaps that trigger a second pass are concrete and checkable — a
`query_rewrite`-detected entity absent from all retrieved content, or a
multi-document-signaling query that only surfaced one document — not an
LLM "deciding" to search again. This keeps the loop's stopping behavior
deterministic and testable (`test_agentic_retrieval_never_exceeds_pass_budget`)
rather than dependent on model judgment, and costs nothing extra against
the fallback generation provider since it happens entirely at the
retrieval layer. Every pass reuses the same `SearchFilters` (ACL principals
included), per the blueprint's "never allow the agent to alter ACL
filters."

### Temporal contradiction detection: conservative negation-flip pairs
`services/temporal.py` flags a contradiction only when two chunks from
*different* documents, on what looks like the same topic (same trailing
section path), each match opposite sides of an explicit keyword pair
(approved/not-approved, open/completed, increased/decreased, etc.) — not
general semantic disagreement. This trades recall of subtler contradictions
for a low false-positive rate, which matters more here: the blueprint's
own instruction is "present both, note the conflict," and a system that
cries contradiction on unrelated statements would train users to ignore
real ones. `resolve_recency` separately implements "prefer newer report
only when the question asks for current status, but only when the
evidence supports a clear ordering" (tied dates -> `ordering_is_clear:
False`).

### ACL enforcement pulled forward from Phase 6
ADR 0003 deferred ACL filtering because there was no ACL data yet. There
still isn't a real identity provider, but the `chunks.acl_principals`/
`classification` columns already exist and populating them costs nothing
now that `pipeline.py` has the document's tenant/owner/customer at chunk-
insert time (see `services/pipeline.py`'s ACL principal derivation). A
chunk is authorized for a request's `principals` list if any principal
intersects `acl_principals`, or `classification == "public"`. This is
applied in `search_index._fetch_chunk_rows` (the single chokepoint every
retrieval path already goes through) and in `expand_parent_child` (so
parent-child expansion can't leak an unauthorized sibling chunk in
around the filter) — never post-generation, per Section 9/15's explicit
requirement. `principals` is optional and defaults to `None` (no
enforcement) on every request shape, so existing Phase 3/4 callers and
tests are unaffected; passing principals is additive, opt-in per-request
until a real auth layer resolves them automatically.

**What this still isn't**: a real identity provider, session/token-based
principal resolution, or SQL-level ACL predicates (matching happens in
Python after fetch — flagged in `search_index.py`, acceptable at this
project's local scale per the same posture ADR 0003 established for FTS5).
Revisit when real authentication exists.

### Table-aware structured retrieval: a real bypass, not a keyword hack
`search_index.structured_table_search` and `POST /retrieval/table-lookup`
query `chunk_type='table'` chunks directly with the same tenant/ACL/
customer/date filters as hybrid search, skipping BM25/vector/RRF/rerank
entirely. This matches the blueprint's point that vector/hybrid ranking is
tuned for narrative recall, not exact row lookup. Full structured
numeric-comparison filtering (`metric > 600000`) needs a normalized
per-report table schema this project's synthetic corpus doesn't have yet —
flagged as future work, not silently approximated.

### Evaluation harness: a real seed set, honestly scoped short of 300+
`app/evaluation/gold_queries.py` ships 10 hand-written queries stratified
across the blueprint's intent categories, keyed by `gold_customers` (not
`gold_document_ids`, since document IDs are generated per-ingest — see
`tests/conftest.py`). `app/evaluation/metrics.py` computes Hit Rate@k and
MRR@k directly against `search_index.hybrid_search` (fast, no LLM), plus a
separate, slower abstention-accuracy pass through the full
retrieval→generation→citation-validation path. `POST /evaluation/run` and
`POST /evaluation/run-abstention` expose both. This is explicitly a
*framework*, not the blueprint's 300+-query production benchmark — reaching
that needs a real document corpus and multi-annotator SME labeling this
project doesn't have. Every eval response reports
`embedding_provider_is_fallback` / `generation_provider_is_fallback` next
to the numbers so a fallback-provider run (see ADR 0004/0005) is never
mistaken for a production-representative one.

### Monitoring: `/system/metrics` over `chat_traces`, not a real dashboard
`GET /system/metrics` aggregates recent `chat_traces` rows into abstention
rate, fallback-provider rate, JSON-retry rate, citation-validation pass
rate, unsupported-claim rate, and p50/p95/p99 latency — the blueprint's
Section 4.4 "monitoring-friendly behavior" list, computed from data that
was already being persisted (Phase 4). This is a local substitute for Azure
Monitor/Application Insights per ADR 0001, sufficient to catch drift during
development, not a production observability stack.

## Consequences
- `SearchFilters.principals`, `ChatRequest.principals`, and
  `SearchRequest.principals` are all optional and default to `None` —
  every Phase 3/4 test and existing caller is unaffected; the 20 new Phase
  5 tests plus the original 37 all pass together (57 total).
- Retrieval-time ACL filtering happens in Python post-fetch, not via a
  SQL predicate or a real Azure AI Search `search.in()` filter — a
  deliberate, documented local-scale substitution, not a security posture
  to carry into production without revisiting per ADR 0001/0003.
- Evaluation numbers from this seed gold set are directional, not a
  substitute for the blueprint's full stratified 300+-query benchmark with
  human-SME comparison (Section 7's later requirement) — that remains
  explicit future work once a real corpus exists.
- GraphRAG, selective multimodal extraction, and full enterprise hardening
  (private endpoints, managed identities, blue/green index deployment,
  disaster recovery, load/soak/pen testing) remain explicit Phase 6 scope
  per the blueprint's own five-phase roadmap.

## Revisit when
A real document corpus and identity provider exist — at that point, grow
`gold_queries.py` toward 300+ with multi-annotator labels, replace the
Python-side ACL intersection with a real authorization service call, and
re-run this phase's exit criteria (Hit Rate@k / MRR@k / abstention
accuracy) against real data before treating any number here as production-
representative.
