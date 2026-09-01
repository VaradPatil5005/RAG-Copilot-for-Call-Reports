# Enterprise RAG Copilot for Call Reports

A production-oriented, layout-aware hybrid RAG platform for enterprise call
reports — grounded answers, page-level citations, ACL-enforced retrieval,
and cross-document intelligence. Built against the two source blueprint
PDFs as the source of truth for architecture and requirements.

**Status: Phase 6 of 6 built — not independently verified in this build
pass** (Foundation + UI shell → Document Ingestion → Hybrid Retrieval
Engine → AI Copilot → Advanced Reasoning → GraphRAG/Security/Evaluation/
Polish). See
[`docs/decisions/0001-local-dev-substitutions.md`](docs/decisions/0001-local-dev-substitutions.md),
[`0003-phase3-hybrid-retrieval.md`](docs/decisions/0003-phase3-hybrid-retrieval.md),
[`0004-embedding-reranking-runtime.md`](docs/decisions/0004-embedding-reranking-runtime.md),
[`0005-generation-model-choice.md`](docs/decisions/0005-generation-model-choice.md),
[`0006-phase5-advanced-reasoning.md`](docs/decisions/0006-phase5-advanced-reasoning.md),
and
[`0007-phase6-graphrag-security-eval.md`](docs/decisions/0007-phase6-graphrag-security-eval.md)
for why this doesn't use real Azure services yet, exactly what stands in
for each one, and — for Phase 6 specifically — **why it was built in a
sandbox with no network access and has not yet been run**. Read ADR
0007's "Verification status" section before treating Phase 6 as
verified the way Phases 1–5 were. A full architecture write-up reflecting
the system as actually built lives in
[`docs/architecture/overview.md`](docs/architecture/overview.md).

## What's here right now

- `apps/web` — Next.js 16 / TypeScript / Tailwind v4 frontend. Full nav
  shell, dashboard with live-state 3D "AI Knowledge Core" and a real
  ingestion-pipeline status panel (all 10 stages, including multimodal
  routing and graph extraction), a real Documents workspace (batch
  upload, live pipeline status, filters, per-document processing
  timeline and extracted-structure viewer), a real Search page (hybrid
  retrieval with filters, per-stage candidate counts, and deep links into
  Documents), a real Copilot page (streaming chat, structured cited
  answers, abstention, click-to-source citations), a real Knowledge Graph
  page (relationship explorer backed by `/graph/query`), a real Admin
  page (system health, security/audit, cost-usage, latest evaluation
  run), and a scoped stub for Evaluation.
- `apps/api` — FastAPI backend. Full document ingestion pipeline (upload →
  validate → extract → normalize), the Phase 3 hybrid retrieval engine
  (hierarchical chunking, fastembed/ONNX embeddings, a SQLite FTS5 +
  hnswlib hybrid index with real RRF fusion and cross-encoder reranking,
  parent-child context expansion, result diversification, `/search` +
  `/retrieval` APIs), and the Phase 4 Copilot (`/chat` SSE streaming,
  structured grounded generation, mandatory two-stage citation validation,
  `chat_traces` persistence). `apps/api/tests/` has a pytest suite (37
  tests) that ingests synthetic sample call reports through the real
  pipeline and exercises chunking, BM25, vector search, RRF, reranking,
  both retrieval endpoints, and the full Copilot chat flow — abstention,
  negation, cross-document citations, citation validation, JSON-retry,
  and trace persistence — end-to-end.
- `docs/decisions` — architecture decision records: the Azure → local-dev
  substitution map (0001), Phase 2's ingestion pipeline (0002), Phase 3's
  hybrid retrieval substitutions (0003), the embedding/reranking runtime
  choice including an honestly-documented sandbox fallback (0004), the
  Phase 4 generation model choice including the same pattern of honesty
  about this sandbox's fallback (0005), Phase 5's advanced reasoning
  (0006), and Phase 6's GraphRAG/security/evaluation/polish work
  including an explicit "this was never executed" verification-status
  section (0007).
- `docs/architecture/overview.md` — a single coherent architecture
  document reflecting the system as actually built, mirroring every ADR
  above.

Everything else in the target repository structure (`services/`,
`packages/`, `infrastructure/`, `evaluation/`) is scaffolded as the project
progresses through phases — not created speculatively ahead of need.

## Phase 3 — Hybrid Retrieval Engine

Implements the blueprint's Sections 3–7 end-to-end, with local substitutes
for every Azure AI Search capability (see ADR 0003 for the full reasoning):

- **Hierarchical chunking** (`services/chunking.py`) — `elements` from
  Phase 2 become 350–500 token passages (10–15% overlap, paragraph/
  sentence-boundary preference, never crossing a section boundary), tables
  split into ≤40-row groups as their own chunks, figures as their own
  chunks, every passage's embedding text prefixed with
  `Document / Section / Page` context, deterministic chunk IDs so
  reprocessing updates rather than duplicates.
- **Embeddings** (`services/embeddings.py`) — `fastembed` (ONNX Runtime,
  `BAAI/bge-small-en-v1.5`, 384 dims), deliberately not
  `sentence-transformers`/PyTorch — see ADR 0004. Content-hash cached so
  reprocessing an unchanged chunk never re-embeds it.
- **Hybrid index** (`services/search_index.py`) — SQLite FTS5 for lexical
  (trigger-synced to `chunks`, no separate index file), `hnswlib` for
  vector (persisted per index version, blueprint's recommended
  `m=8/efConstruction=800/efSearch=500/cosine`), real Reciprocal Rank
  Fusion, `fastembed`'s `TextCrossEncoder` reranking, result
  diversification (cap per document/section), and parent-child context
  expansion pulling in adjacent sibling chunks within token budget.
- **API** (`routers/retrieval.py`) — `POST /search` (ranked results with
  per-stage scores, for the Search UI) and `POST /retrieval` (final
  assembled, expanded context — what Phase 4's Copilot will consume
  directly), both logging a full retrieval trace.
- **Search UI** — real hybrid search with customer/date filters, per-result
  relevance/BM25/vector/RRF scores, table results rendered as tables, and
  deep links into the Documents detail panel.

**Verified**: ingested three synthetic Contoso/Globex sample call reports
through the real pipeline end-to-end (chunking → embedding → indexing all
fire as distinct pipeline stages), then ran the exact test queries from the
phase spec against `/search` and `/retrieval` — risks scoped correctly to
Contoso, the Contoso *follow-up* report (status: Completed) ranked #1 for
a "what's the current pricing status" question ahead of the original ask,
both Contoso and Globex surfaced for "which customers mentioned Acme
Corp," and a pipeline-value question correctly retrieved table chunks
specifically. 19 pytest tests cover chunking boundaries/determinism, table
separation, BM25/vector/RRF/reranking standalone, all four spec queries,
filtering, diversification, and index rebuild-without-data-loss — all
passing. Frontend: clean `next build` and `next lint`.

**A real bug this caught**: the vector index's `search()` originally
clamped result count `k` against hnswlib's *total-ever-added* point count,
which crashes once any points are `mark_deleted` (e.g. after a document
reprocess) and fewer than `k` active points remain. Fixed to clamp against
currently-*active* points instead — caught by the reprocess-then-search
test, not by manual spot-checking.

**Known gaps / not yet done**: generation (GPT-4o Mini or equivalent) is
explicitly Phase 4 scope — `/retrieval`'s assembled context is ready for a
Copilot to consume, but nothing calls an LLM yet. ACL enforcement is Phase
6 — `chunks` carries `tenant_id`/`acl_principals`/`classification`
columns and `/search` filters on `tenant_id`, but principal-level ACL
filtering isn't wired in. HNSW parameters and retrieval quality numbers
are the blueprint's recommended starting values, not validated against a
gold benchmark (that's the "300+ query gold set + exhaustive-KNN recall
harness" work explicitly listed as Phase 2 optimization work in the
blueprint's own roadmap, i.e. still ahead of us). **Embedding quality in
this specific sandbox**: this environment's network egress doesn't reach
`huggingface.co`, so verification here ran on the documented
deterministic fallback provider, not real `fastembed` embeddings — see
ADR 0004. On any machine with normal internet access, real
`BAAI/bge-small-en-v1.5` embeddings and cross-encoder reranking load
automatically with no code change.

## Phase 5 — Advanced Reasoning

Implements the blueprint's remaining pre-GraphRAG advanced capabilities
(Sections 1.1, 2.2, 4.1, 4.2, 4.4, 9/15) end-to-end — see
[ADR 0006](docs/decisions/0006-phase5-advanced-reasoning.md) for full
reasoning on every decision below:

- **Query rewriting & entity aliasing** (`services/query_rewrite.py`) —
  company alias/domain-synonym/acronym expansion from a maintained table
  (never from untrusted document content), identifier-heavy vs. semantic
  intent classification, and "latest"/"previously" recency-hint detection.
  Retrieval-only: the original query is always what's shown to the user
  and passed to generation.
- **Bounded agentic retrieval loops** (`services/agentic_retrieval.py`) —
  up to 3 retrieval passes, each triggered by a concrete coverage gap (a
  detected entity missing from retrieved content, or a multi-document
  query that only surfaced one document), each pass respecting the same
  ACL filters. Deterministic, code-level budget enforcement, not an LLM
  "deciding" to search again.
- **Temporal & contradiction handling** (`services/temporal.py`) —
  conservative negation-flip detection (approved/not-approved,
  open/completed, increased/decreased, etc.) across different documents on
  the same topic, plus recency resolution that only picks a "current"
  answer when the evidence supports a clear date ordering.
- **ACL enforcement at retrieval time** (`services/pipeline.py` +
  `services/search_index.py`) — pulled forward from Phase 6 now that
  `chunks.acl_principals`/`classification` are actually populated
  (tenant/owner/customer-derived principals). Enforced in
  `_fetch_chunk_rows` and `expand_parent_child` — the single retrieval
  chokepoints every path goes through — never post-generation.
  `principals` is optional on every request shape and defaults to no
  enforcement, so it's fully backward compatible.
- **Table-aware structured retrieval** (`search_index.structured_table_search`,
  `POST /retrieval/table-lookup`) — exact filters over table chunks,
  bypassing BM25/vector/RRF/rerank entirely for row-lookup questions.
- **Evaluation harness** (`app/evaluation/`) — a 10-query gold set
  stratified by intent category, `POST /evaluation/run` (Hit Rate@k /
  MRR@k, fast, retrieval-only) and `POST /evaluation/run-abstention`
  (abstention accuracy/precision + false-abstention rate, full
  retrieval→generation→citation-validation path). Explicitly a framework
  seed, not the blueprint's 300+-query production benchmark — see ADR
  0006 for what's still needed to get there.
- **Monitoring** (`GET /system/metrics`) — abstention rate, fallback-
  provider rate, JSON-retry rate, citation-validation pass rate,
  unsupported-claim rate, and p50/p95/p99 latency aggregated from
  `chat_traces` — the blueprint's Section 4.4 "monitoring-friendly
  behavior" list, computed from data Phase 4 was already persisting.
- **Copilot integration** (`routers/copilot.py`) — `/chat` now runs
  query-rewritten, agentic, ACL-filtered retrieval and surfaces
  `contradictions`, `latest_document_id`/`latest_meeting_date`, and
  `retrieval_passes` in its final SSE event, alongside everything Phase 4
  already returned.

**Verified**: 20 new pytest tests — query rewriting/aliasing unit tests,
temporal contradiction detection (positive, same-document negative,
unrelated-topic negative), recency ordering (clear vs. tied dates), ACL
enforcement (unauthorized principal blocked, authorized tenant/owner
principal allowed, `/chat` abstains cleanly for an unauthorized principal
instead of leaking evidence), the table-lookup endpoint, bounded agentic
retrieval (multi-document coverage, pass-budget enforcement), the
evaluation endpoints, and `/system/metrics` — all passing alongside the
existing 37 Phase 3/4 tests (57 total, `pytest tests/`).

**Known gaps / not yet done**: GraphRAG, selective multimodal extraction,
and full enterprise hardening (private endpoints, managed identities,
blue/green index deployment, disaster recovery, load/soak/penetration
testing) are explicit Phase 6 scope. ACL matching happens in Python
post-fetch, not as a SQL predicate or a real Azure AI Search `search.in()`
filter or a real identity provider — a documented local-scale
substitution (see ADR 0006), not yet a production security posture. The
evaluation gold set is 10 queries, not 300+, and needs a real document
corpus plus multi-annotator SME labeling to get there.

## Phase 4 — AI Copilot

Implements the blueprint's grounded-generation contract end-to-end:

- **Generation service** (`services/generation.py`) — a provider-agnostic
  `LLMProvider` interface with real implementations for **Gemini** (AI
  Studio free tier, native JSON mode, recommended default), **Groq**
  (fastest, generous free tier), and **Ollama** (fully offline fallback),
  selected automatically by `get_default_provider()` based on which API
  key/daemon is actually reachable. When none are — which is the case in
  this sandbox, whose network egress allowlist doesn't reach any of the
  three — a documented deterministic **extractive fallback** takes over
  (same honesty pattern as Phase 3's embedding fallback in ADR 0004). See
  ADR 0005 for the full comparison and exactly what was checked before
  concluding this sandbox needs it.
- **Structured, cited output** — every answer is forced JSON
  (`answer` / `key_findings` / `citations` / `confidence` / `abstained` /
  `abstention_reason`), with a mandatory retry-on-malformed-JSON path
  (`generate_structured_answer()`), exercised and tested even though the
  primary providers' native JSON modes rarely need it.
- **Citation validation** (`services/citation_validator.py`) — every
  citation is checked twice, not once: existence (does the `chunk_id`
  actually appear in retrieved evidence?) and, mandatorily, **support**
  (does the cited chunk's content actually overlap with the claim, via
  token overlap + embedding cosine similarity?). Failing citations are
  stripped and the answer is flagged, never silently passed through.
- **API** (`routers/copilot.py`) — `POST /chat` streams real SSE status
  events (`understanding_query → retrieving_evidence → reasoning →
  generating → validating → final`) driven by actual pipeline stages, not
  a timer; a lightweight heuristic intent classifier sizes retrieval
  `top_k`; every exchange is persisted to `chat_traces` (query, retrieved
  chunk IDs, answer, citation-validation counts, model, latency).
- **Copilot UI** — real streaming chat replacing the Phase 1 stub:
  structured answer rendering (findings / clickable citation chips that
  deep-link into the Documents page at the right document / abstention
  banner / confidence badge), example queries, and a Copilot-scoped
  Knowledge Core orb driven by real chat state for that exchange (the
  dashboard orb intentionally stays on its existing demo cycle — explicit
  scope-down, not an oversight; true cross-page live state would need a
  shared client store or a second SSE subscription, out of scope here).

**Verified**: ran the exact section-9 test scenarios from the phase spec
against the real `/chat` endpoint — risks question cites the original
Contoso report; the pricing-status question surfaces the *follow-up*
report's "Completed" status ahead of the original "Open" one; the
approval question preserves the source's negation correctly and a direct
adversarial variant confirms a "has not yet been approved" fact never
gets inverted; the Acme Corp question cites both Contoso and Globex; an
unanswerable revenue question and a nonexistent-customer question both
abstain cleanly with a stated reason and zero citations; repeating a
query returns consistent citations. 18 pytest tests cover all of this
plus citation-validator unit tests (hallucinated `chunk_id`, a real but
unrelated `chunk_id`), the JSON-retry path (both the recovers-on-retry and
still-fails-after-retry cases), `chat_traces` persistence, and the intent
classifier — all passing alongside the 19 Phase 3 tests (37 total). `npm
run build` and `npm run lint` are clean.

**Known gaps / not yet done**: bounded agentic multi-pass retrieval and
the full intent taxonomy are explicitly Phase 5 scope — Phase 4's
classifier only distinguishes single-pass / multi-document / unanswerable
to size `top_k`. Cross-page dashboard orb state sharing is explicitly
scoped down (see above). **Generation quality in this specific sandbox**:
same caveat as Phase 3's embeddings — this environment's network egress
doesn't reach any hosted or local LLM, so verification here ran on the
documented deterministic extractive fallback, not a real instruction-tuned
model; see ADR 0005 for exactly what that fallback can and can't do, and
why the citation support-check matters equally for it and for a real
model. On any machine with a free Gemini/Groq API key (or a local Ollama
daemon) reachable, `get_default_provider()` uses it automatically with no
code change.

## Phase 6 — GraphRAG, Security Hardening, Evaluation & Polish (this phase)

Implements the master prompt's 6.1–6.7 in order, per the blueprint's
remaining scope (Sections 9–13, the advanced-capability items, and the
production-acceptance checklist). Full reasoning and every substitution
in [`docs/decisions/0007-phase6-graphrag-security-eval.md`](docs/decisions/0007-phase6-graphrag-security-eval.md) —
**read that ADR's "Verification status" section before anything else in
this README section**: this phase was built in a sandbox with no
outbound network access, so `pytest` and the frontend build have never
been run against it.

- **6.1 GraphRAG** — entity/relationship extraction (`services/graph_extraction.py`,
  LLM-based when a real provider is reachable, deterministic rule-based
  otherwise) into relational `graph_nodes`/`graph_edges` tables
  (`services/graph_store.py`), a `POST /graph/query` API, a
  `cross_document_graph` Copilot intent, and a real (list/card, not
  force-directed canvas) Knowledge Graph UI page.
- **6.2 Selective multimodal extraction** — routes only low-OCR-
  confidence, no-caption-figure, or low-cell-count-table pages to a
  vision pass (`services/multimodal_extraction.py`), Gemini's native
  image input when reachable, an honestly-labeled OCR-only fallback
  otherwise.
- **6.3 Production-grade ACL enforcement** — real JWT auth
  (`services/auth.py`, `/auth/dev-token` as a local stand-in for a real
  IdP), a genuine SQL predicate (`db.acl_predicate_sql`, SQLite's
  `json_each`) enforced at every retrieval stage instead of Phase 5's
  Python post-fetch check, and a structured audit trail
  (`access_audit_log`).
- **6.4 Full evaluation benchmark** — a 24-customer/48-document synthetic
  corpus with known ground truth (`evaluation/synthetic_corpus.py`) and a
  317-query stratified gold set generated from it
  (`evaluation/gold_queries_v2.py` — **actually run**: `n_queries: 317,
  all_within_tolerance: true`), semantic relevancy / citation precision-
  recall / faithfulness metrics, the exhaustive-KNN recall oracle, and
  an offline HNSW grid-search runner.
- **6.5 Enterprise hardening** — real blue/green index deployment
  (`build_new_index_version` / `switch_active_index` / `rollback_active_index`,
  fixing a real bug found while building it — see the ADR), disaster
  recovery from raw storage alone (`services/disaster_recovery.py`,
  which fixed a real classification-recoverability gap by adding an
  immutable metadata sidecar), an adversarial prompt-injection test
  corpus (**actually run** against this sandbox's active provider — zero
  fabricated citations, zero prompt leakage, valid schema under 8 attack
  categories), PII detection/redaction (`services/pii.py`), and a load
  test script (written, not yet run — `docs/load-test-report.md`).
- **6.6 Admin panel** — real per-provider token usage capture (not
  estimated), `/system/admin/overview` + `/system/admin/cost-usage`, a
  real Admin UI page. Caught and fixed a real bug in this pass:
  `/system/metrics` had silently lost its route decorator earlier in
  this build and was unreachable dead code.
- **6.7 Final polish** — a manual accessibility pass (no browser
  available for an automated axe run) that found and fixed several real
  issues (icon-only buttons with no accessible name, unlabeled inputs,
  a color-only security indicator), a Playwright end-to-end spec for the
  full upload → processed → search → ask → cited-answer journey (written
  with selectors verified against the real component source, not yet
  run), this ADR, and `docs/architecture/overview.md`.

**Verified in this build pass** (the parts with no `fastapi`/`hnswlib`
dependency, actually executed, not just written): the gold-query
generator's output and stratification, `ann_recall_at_k`'s computation
against a hand-constructed example, `pii.py`'s detection/redaction/Luhn
check, and the adversarial corpus run end-to-end against the real
generation + citation-validation code path.

**Not yet verified — the required next step before calling Phase 6
"done" the way Phases 1–5 were**:
```bash
cd apps/api && pip install -r requirements.txt -r requirements-dev.txt && pytest -v
cd ../web && npm install && npm run build && npm run lint
npx playwright install --with-deps chromium && npm run test:e2e   # needs both servers running
```

## Running it locally

### Frontend

```bash
cd apps/web
npm install
npm run dev
```

Opens at `http://localhost:3000`.

**Note on fonts:** `globals.css` currently uses system-font fallbacks
(`Space Grotesk` / `Inter` / `JetBrains Mono` stacks) because the build
sandbox this was created in had no network access to fetch Google Fonts.
If you have network access, you can re-enable `next/font/google` in
`src/app/layout.tsx` for pixel-exact web fonts — see the comment in
`globals.css` for what was reverted and why.

### Backend

```bash
cd apps/api
pip install -r requirements.txt
cp .env.example .env   # optional -- fill in a free Gemini/Groq key, or leave
                        # blank to run on Ollama (if running locally) or the
                        # documented extractive fallback -- see ADR 0005
uvicorn app.main:app --reload --port 8000
```

Health check: `http://localhost:8000/system/health` — reports which
generation provider is actually active (`generation_service`).

Requires `tesseract-ocr` and `poppler-utils` on the host for the OCR
fallback path (`apt-get install tesseract-ocr poppler-utils` on Debian/
Ubuntu). Everything else is pure-Python.

The first `/search` or `/retrieval` call (or document upload) downloads
`fastembed`'s ONNX model weights (~100–200MB) from Hugging Face on first
use and caches them locally — needs outbound network access to
`huggingface.co` once. If that's unreachable, embeddings/reranking fall
back to a deterministic local substitute automatically (see ADR 0004);
`/system/health` reports which mode is active.

### Tests

```bash
cd apps/api
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Ingests three synthetic sample call reports through the real pipeline
(slow — a couple of minutes — since it's exercising actual extraction/
chunking/embedding/indexing, not mocks). As of Phase 5 this ran 57
tests: 19 against chunking, BM25, vector search, RRF, reranking, and the
`/search` + `/retrieval` endpoints (Phase 3), 18 against the `/chat`
Copilot endpoint (Phase 4), and 20 against query rewriting, temporal
contradiction detection, ACL-enforced retrieval, table lookup, bounded
agentic retrieval, and the evaluation/monitoring endpoints (Phase 5).

Phase 6 added `tests/test_phase6_graph.py`, `test_phase6_multimodal.py`,
`test_phase6_acl.py`, `test_phase6_evaluation.py`,
`test_phase6_hardening.py`, `test_phase6_adversarial.py`,
`test_phase6_pii.py`, and `test_phase6_admin.py` — **these have not been
run** (no networked environment available to install `fastapi`/`hnswlib`/
`pytest` in the sandbox that built them; see ADR 0007). Run `pytest -v`
in a networked environment and update this section with the real,
current total before treating Phase 6 as verified.

The frontend expects the API at `http://localhost:8000` by default; copy
`apps/web/.env.local.example` to `apps/web/.env.local` and adjust
`NEXT_PUBLIC_API_BASE` if you run the API elsewhere. As of Phase 6.3,
`/documents/*`, `/search`, `/retrieval`, `/chat`, and `/graph/query`
require a bearer token — the frontend mints and caches one automatically
via `/auth/dev-token` (`src/lib/auth.ts`), a local stand-in for a real
login flow.

## 8-week roadmap

| Week | Phase | Deliverable |
|---|---|---|
| 1 | Foundation + UI | Clickable product shell ✅ |
| 2 | Document ingestion | Upload PDF → auto-processes ✅ |
| 3 | Hybrid retrieval | Working RAG retrieval (BM25+HNSW+RRF+rerank) ✅ |
| 4 | AI Copilot | Grounded, cited, streaming answers ✅ |
| 5 | Advanced reasoning | Bounded agentic retrieval, temporal/table handling ✅ |
| 6 | Intelligence layer | GraphRAG, selective multimodal ✅ (unverified — see ADR 0007) |
| 7 | Security + evaluation | ACL enforcement, 300+ query benchmark ✅ (unverified — see ADR 0007) |
| 8 | Polish + deploy | Perf tuning, observability, docs, demo ✅ (unverified — see ADR 0007) |

Full phase-by-phase acceptance criteria live in the original planning
conversation and are mirrored into `docs/architecture/overview.md`.

## Core principles (non-negotiable throughout)

1. Dynamic business facts stay in retrieval — fine-tuning is only ever used
   for stable behaviors (classification, formatting, citation enforcement,
   abstention), never to memorize changing report content.
2. ACL filtering happens **before** evidence reaches the model, not after.
3. Every answer claim must be traceable to a chunk → document → page.
4. Hybrid retrieval (lexical + vector + rerank) is the default, not
   vector-only.
5. No phase is "done" because code exists — only when its exit criteria are
   verified.
6. No metric or "production ready" claim is made without an actual
   measured run behind it.
