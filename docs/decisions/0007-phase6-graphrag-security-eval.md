# 0007 — Phase 6: GraphRAG, Security Hardening, Evaluation & Polish

## Status
Implemented, **not executed**. Read the "Verification status" section
before trusting anything else in this document as a measured result.

## Context
Phase 6 is the final phase: GraphRAG (6.1), selective multimodal
extraction (6.2), production-grade ACL enforcement (6.3), a full 300+
query evaluation benchmark (6.4), enterprise hardening (6.5), an admin
panel (6.6), and final polish (6.7) — per the master prompt's own
non-negotiable principles carried over from Phases 1–5 (retrieval stays
the source of dynamic facts, ACL filtering happens before generation,
every claim traces to a source chunk, hybrid retrieval stays the default
path, no phase is called done without a measured run behind it, document
content is always untrusted data).

## Verification status — read this first
This entire phase was built in a sandboxed environment with **no outbound
network access**. `pip install` failed even for packages already pinned
in `requirements.txt` (`fastapi`, `hnswlib`, `fastembed`, `pytest` are
not installed); `npm install` returned `403 Forbidden` from the npm
registry. This means:

- Every backend Python file was **statically compiled**
  (`python3 -m py_compile`) and manually re-read for correctness, but the
  `pytest` suite (including every new `tests/test_phase6_*.py` file) has
  **never been run**.
- The handful of modules with no `fastapi`/`hnswlib` dependency — the
  gold-query generator, `quality_metrics.py`'s pure functions,
  `pii.py`, the adversarial corpus run against the actual active
  generation provider — **were** executed directly and their real output
  is quoted in the corresponding phase's completion report in this
  project's build history. This is the exception, not the rule, for this
  phase.
- The entire frontend (Admin panel, Graph page, accessibility fixes,
  Playwright e2e test) was written and manually reviewed but never
  built, typechecked, or rendered — no `node_modules`, no browser.
- **Before treating Phase 6 as "done" in the sense Phases 1–5 were**, run
  in a networked environment:
  ```
  cd apps/api && pip install -r requirements.txt -r requirements-dev.txt
  pytest -v
  cd ../web && npm install && npm run build && npx playwright install --with-deps chromium && npm run test:e2e
  ```
  and replace this section, `docs/load-test-report.md`, and the
  README's Phase 6 status section with the actual results.

## Decisions

### 6.1 — GraphRAG: relational tables in SQLite, not a new database
`services/graph_store.py` implements `graph_nodes`/`graph_edges` as plain
SQLite tables in the existing DB, using `networkx` (already present,
Python-only) purely as an in-memory traversal helper for multi-hop
queries — SQLite rows remain the source of truth, so every edge survives
a process restart and carries full ACL/source-chunk provenance. This
matches ADR 0003's reasoning for keeping FTS5 + hnswlib in one file
rather than adding an engine.

Extraction (`services/graph_extraction.py`) automatically selects between
an LLM-based extractor (reusing `generation.LLMProvider`, no second
client) and a deterministic rule-based extractor, based on
`generation.provider_is_fallback()`. This sandbox always runs the
rule-based path (see "no hosted LLM reachable" above) — its lower recall
relative to an LLM reading prose is expected and labeled per-edge via the
`extractor` field, not hidden. Alias resolution is deterministic-first
with an audited fuzzy-similarity fallback (`graph_alias_audit`) and never
auto-merges below a conservative threshold — an incorrect merge here
could affect a real business decision ("which customers share
Competitor X").

### 6.2 — Multimodal: routing rule first, vision provider second
`services/multimodal_extraction.py`'s `evaluate_routing` is a pure
function over already-extracted elements (low OCR confidence, a figure
with no usable caption, or a table with suspiciously few cells) — kept
separate from the vision call itself so the routing *decision* is
directly testable without needing a real vision model. `GeminiVisionProvider`
and `OCRFallbackVisionProvider` follow the same reachability-gated
pattern as `generation.py`'s text providers; this sandbox always runs the
fallback, which honestly labels its output ("[vision model unreachable]")
rather than fabricating a plausible-sounding chart description.

### 6.3 — ACL enforcement: a real SQL predicate, and real auth
Two separable changes, both required by the spec:

1. **Auth**: `services/auth.py` replaces the Phase 4/5 shortcut of
   accepting `principals`/`tenant_id` as client-supplied request-body
   fields with a JWT verified server-side (`require_identity`).
   `/auth/dev-token` mints tokens locally (gated by `AUTH_DEV_MODE`) as a
   stand-in for a real deployment's enterprise IdP login flow, which
   would issue the JWT this service only ever verifies. A forged/tampered
   token is rejected by signature verification before any claim in it is
   trusted — there is no longer a request-body field to forge in the
   first place.
2. **SQL-level filtering**: `db.acl_predicate_sql()` builds a genuine
   `WHERE` predicate using SQLite's built-in `json_each`, applied at
   every retrieval stage (`lexical_search`, `_fetch_chunk_rows`,
   `expand_parent_child`, and GraphRAG's queries) so an unauthorized row
   is excluded by the query engine itself, never fetched into Python and
   filtered afterward. The one documented exception: raw hnswlib has no
   native metadata-filtered ANN (unlike Azure AI Search's
   `vectorFilterMode: preFilter`, which skips non-matching nodes during
   graph traversal) — `IndexManager.search`'s candidate *labels* still
   come from an ANN search over the full vector set, but resolving them
   to chunk_ids is itself an ACL-predicated SQL query, so an unauthorized
   chunk_id is never present in the *returned* result at all. This is a
   real, acknowledged gap relative to true production pre-filtering, not
   a silent one.

A structured audit trail (`access_audit_log`, `services/audit.py`)
records identity → constructed ACL filter → evidence chunk_ids actually
returned for every `/search`, `/retrieval`, `/chat`, and `/graph/query`
call.

### 6.4 — 300+ query benchmark: generated from known ground truth, not padded
The Phase 1–5 corpus (3 documents) is too small to support 300 genuinely
distinct queries without duplication.
`services/../evaluation/synthetic_corpus.py` generates a 24-customer,
48-document synthetic corpus with known ground truth (risks,
competitors, actions, pipeline values, approval-status changes);
`gold_queries_v2.py` derives 317 stratified queries from it
programmatically, matching the blueprint's category proportions —
**verified by actually running the generator** (`n_queries: 317,
all_within_tolerance: true`, every category within the stated 5%
tolerance). This is still synthetic, programmatically-derived content,
not SME-annotated real enterprise data — stated plainly in that module's
docstring, not implied to be more than it is.

`ann_recall.py` implements the exhaustive-KNN oracle the project had
never run before this phase (flagged in ADR 0004); `hnsw_tuning.py`
implements the blueprint's own grid-search procedure. Neither has
actually been executed against a real corpus in this build pass — see
"Verification status."

### 6.5 — Enterprise hardening: real blue/green, a real DR fix, honest gaps elsewhere
Two items here went beyond "build the harness" to an actual fix, found
by tracing the logic before ever running it:

- **Blue/green indexing** (`search_index.py`): `_persist()` was
  unconditionally overwriting the active-index alias on every save —
  which would have made a *new, unvalidated* index version "active" the
  moment its first batch was written, defeating blue/green entirely.
  Fixed: the alias is now only set on first bootstrap; switching between
  built versions is `switch_active_index`'s job alone.
- **Disaster recovery** (`services/disaster_recovery.py`): tracing the
  actual recovery path found that `classification` (a security field)
  was recoverable only from the SQLite metadata DB — a metadata-DB-only
  disaster would have made it unrecoverable from the immutable raw PDF
  zone, and a naive default risked under-protecting a confidential
  document. Fixed by writing an immutable `metadata.json` sidecar next to
  every `source.pdf` at upload time; recovery still fails closed
  (defaults to `"confidential"`, never `"public"`) if even the sidecar is
  missing.

Adversarial/prompt-injection testing (`evaluation/adversarial_corpus.py`)
was actually run against this sandbox's active provider — no fabricated
citations, no system-prompt leakage, valid JSON schema under 8 attack
categories, verified with real output. The load test
(`loadtest/locustfile.py`) and PII redaction's integration path are
written but unexecuted (`docs/load-test-report.md` is checked in with an
explicit "NOT YET RUN" status rather than invented numbers).

### 6.6 — Admin panel: real token usage, not an estimate
Added `last_usage` capture to every generation provider from the
provider's own API response (`usageMetadata` for Gemini, `usage` for
Groq, eval counts for Ollama, and a genuine `{0,0,0}` for the extractive
fallback, since it makes no LLM call at all) — verified directly:
`GenerationResult.usage == {'prompt_tokens': 0, 'completion_tokens': 0,
'total_tokens': 0}` for the fallback path. Cost is reported only where
this project has a documented pricing basis (`$0` for the free tiers ADR
0005 chose, `None`/"unknown" for anything else) rather than guessing a
per-token rate. `/system/admin/overview` reuses `health()`/`metrics()`
rather than a parallel aggregation path, per the spec's instruction.

A real, unrelated bug was caught while extending this router: an earlier
edit in this same build pass had accidentally dropped `/system/metrics`'s
route decorator, silently turning it into dead code. Fixed, with a
regression test (`test_system_metrics_route_is_registered`) added
specifically so it can't recur silently.

### 6.7 — Final polish
A manual accessibility pass (no automated axe run was possible — no
browser in this sandbox) found and fixed several real issues: three
icon-only buttons with no accessible name (send, remove-file, close-panel),
two unlabeled text inputs (search, chat), toggle-button groups exposing
no selected state to assistive tech, and a table row that signaled a
security-relevant condition (zero evidence returned) by background color
alone. A Playwright e2e spec covering the full upload → processed →
search → ask → cited-answer journey was written with selectors verified
against the actual component source (not guessed) — see "Verification
status" for why it hasn't been run.

## What a real Azure deployment would need instead (cumulative, Phase 6)
- `/auth/dev-token` removed; the real enterprise IdP (Azure AD/Entra ID)
  issues tokens this service only verifies against the IdP's JWKS.
- Azure AI Search's native `vectorFilterMode: preFilter` in place of this
  project's SQL-predicated post-ANN-search filtering.
- A real vision-capable model call for every routed multimodal page
  (Gemini's native image input, per the blueprint) instead of the
  OCR-only fallback.
- The 300+ query gold set replaced or supplemented with real,
  multi-annotator SME-labeled queries against real call reports.
- The HNSW grid search and full benchmark actually run, with their
  results replacing every "not yet measured" placeholder in this ADR and
  in `docs/load-test-report.md`.
- A real PII detection service (Azure AI Language) in place of this
  project's regex/Luhn-based detector, for materially better recall and
  category coverage (names, addresses, dates of birth).
- Role-based (not just identity-based) access control in front of
  `/evaluation/*` and `/system/*`, which remain intentionally open
  internal/operator endpoints in this local substitution.
- A cross-process index-alias invalidation mechanism for blue/green in a
  multi-worker/multi-replica deployment (this phase's implementation
  invalidates a single process's cached index handle only).
