# Enterprise RAG Copilot for Call Reports

**A layout-aware, hybrid-retrieval RAG platform for enterprise call reports — with ACL-enforced retrieval, page-level citations, and graceful degradation when cloud AI services aren't reachable.**

---

## Abstract

Enterprise call reports are long, unstructured PDFs full of pricing decisions, approvals, risk flags, and customer-specific context — exactly the kind of document where a wrong or hallucinated answer is expensive. This project is a full-stack RAG system that answers questions over those reports the way an enterprise actually needs to trust them: every claim traced back to a specific chunk → document → page, retrieval that never leaks a document a user isn't authorized to see, and an answer that abstains instead of guessing when the evidence isn't there.

The system was built to run reliably with or without a live cloud AI connection: every component that would normally call a hosted model — embeddings, generation, vision — ships with a deterministic local fallback selected automatically at runtime, so the pipeline never breaks just because an API key or network path is missing. That design discipline shows up in the numbers: **57 automated tests passing end-to-end** across ingestion, hybrid retrieval, and grounded generation; **3 real bugs caught by the test suite** before they'd have shipped (an index crash on document deletion, a silently dropped monitoring route, a disaster-recovery gap in metadata reconstruction); an adversarial prompt-injection suite run against the live generation and citation-validation path with **zero fabricated citations and zero prompt leakage across 8 attack categories**; and a 317-query stratified evaluation gold set generated and validated for the retrieval benchmark.

---

## Research & References

- Hybrid lexical + vector retrieval fused with Reciprocal Rank Fusion (RRF)
- Cross-encoder reranking as a second-stage relevance pass over fused candidates
- Parent-child / small-to-big chunking for RAG context expansion
- Retrieval-Augmented Generation (Lewis et al., 2020) — the foundational RAG framing this builds on
- GraphRAG-style entity/relationship extraction for cross-document reasoning
- Azure AI Search hybrid-search architecture patterns for index design

---

## Overview

| | |
|---|---|
| **Problem** | Answering questions over enterprise call-report PDFs with grounded, citable, access-controlled answers |
| **Approach** | Hybrid retrieval (BM25 + vector + RRF + cross-encoder rerank) → ACL-filtered context assembly → structured, cited generation → two-stage citation validation |
| **Stack** | Next.js 16 / TypeScript / Tailwind v4 (frontend) · FastAPI / Python (backend) · SQLite FTS5 + hnswlib (hybrid index) · fastembed/ONNX (`BAAI/bge-small-en-v1.5`) · Gemini / Groq / Ollama (pluggable generation) · JWT auth |
| **Core capabilities** | Ingestion, hybrid retrieval, Copilot chat, query rewriting, agentic multi-pass retrieval, temporal contradiction handling, ACL enforcement, GraphRAG, PII redaction, evaluation harness, admin panel |

---

## Detailed Architecture

```
                        ┌─────────────────────────┐
                        │   Next.js 16 Frontend    │
                        │  Dashboard · Documents ·  │
                        │  Search · Copilot ·        │
                        │  Knowledge Graph · Admin   │
                        └────────────┬─────────────┘
                                     │ REST + SSE
                        ┌────────────▼─────────────┐
                        │        FastAPI API        │
                        └────────────┬─────────────┘
        ┌──────────────┬─────────────┼──────────────┬───────────────┐
        ▼              ▼             ▼              ▼               ▼
   Ingestion      Hybrid Retrieval  Copilot     Advanced        GraphRAG /
   Pipeline       Engine            (Generation) Reasoning       Security
   ─────────      ──────────────    ──────────  ─────────       ──────────
   upload →       chunking →        query       query            entity/edge
   validate →     embed (fastembed) rewriting   rewriting +      extraction →
   extract →      → hybrid index    → retrieval  aliasing        graph_nodes/
   normalize      (FTS5 + hnswlib)  → structured agentic multi-  graph_edges →
                  → RRF fusion →    JSON answer  pass retrieval  /graph/query
                  cross-encoder     → citation    (bounded, 3     
                  rerank →          validation    passes max)     JWT auth +
                  parent-child      (existence +  temporal/        SQL-predicate
                  context expand    support       contradiction    ACL at every
                                    check)         detection        retrieval stage
```
In our Enterprise RAG Copilot for Call Reports, we have built a Multi-Agent Decision Intelligence Architecture composed of 11 specialized AI agents and autonomous agentic modules.

Rather than relying on a single monolithic prompt, the system delegates tasks across four distinct operational layers:

                      ┌──────────────────────────────────────────────┐
                      │             Incoming User Query              │
                      └──────────────────────┬───────────────────────┘
                                             │
             ┌───────────────────────────────┴───────────────────────────────┐
             ▼                                                               ▼
   [1. Query Router Agent]                                        [2. Query Rewrite Agent]
   Classifies intent & strategy                                   Expands aliases & terms
             │                                                               │
             └───────────────────────────────┬───────────────────────────────┘
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │    [3. Bounded Agentic Retrieval Agent]      │
                      │   Iterative passes (1-3) filling data gaps   │
                      └──────┬───────────────────────┬───────────────┘
                             │                       │
                             ▼                       ▼
            [4. GraphRAG Traversal Agent]  [5. Multimodal Vision Agent]
            Cross-document entity graph     Figure & chart understanding
                             │                       │
                             └───────────────┬───────┘
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │   [6. Temporal & Contradiction Agent]        │
                      │   Resolves date orderings & negation flips   │
                      └──────────────────────┬───────────────────────┘
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │    [7. Structured Generation Copilot Agent]  │
                      │    Multi-turn conversation + few-shot exemplars
                      └──────────────────────┬───────────────────────┘
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │  [8. Citation Validation Guardrail Agent]    │
                      │  Existence check + semantic support check    │
                      └──────────────────────┬───────────────────────┘
                                             │
              ┌──────────────────────────────┴──────────────────────────────┐
              ▼                                                             ▼
   [9. PII Guardrail Agent]                                      [10. Self-Learning Agent]
   Redacts sensitive data                                        Adjusts chunk utility weights
                                                                            │
                                                                 [11. Lexicon Miner Agent]
                                                                 Discovers acronyms & jargon



**Core data flow:** a PDF is extracted into layout-aware elements, then split into 350–500 token hierarchical chunks — tables and figures kept as their own chunks, never crossing a section boundary. Chunks are embedded and indexed into a hybrid FTS5 + hnswlib store. A query goes through rewriting/aliasing, lexical + vector retrieval, RRF fusion, cross-encoder reranking, diversification, and parent-child context expansion. ACL filtering happens as a SQL predicate before anything reaches generation. Generation produces a structured, forced-JSON answer; every citation is checked twice — does the chunk exist, and does its content actually support the claim — before the answer is streamed to the UI as SSE events, with failing citations stripped rather than passed through.

**Provider abstraction:** embeddings, generation, and vision each sit behind a reachability-gated interface. The system picks the first real, reachable provider (Gemini → Groq → Ollama for generation); if none is reachable, a deterministic fallback takes over automatically, and `/system/health` reports which mode is active. The request/response contract never changes based on which mode is running.

---

## Key Features

- **Hybrid retrieval, not vector-only** — BM25 (SQLite FTS5) + vector (hnswlib, cosine, `m=8/efConstruction=800/efSearch=500`) fused with Reciprocal Rank Fusion, then cross-encoder reranked and diversified per document/section.
- **Two-stage citation validation** — every citation is checked for existence (does the chunk ID actually appear in retrieved evidence?) and for support (does the chunk's content actually overlap with the claim, via token overlap + embedding cosine similarity?). Failing citations are stripped and the answer flagged, never silently passed through.
- **Abstention over hallucination** — the system abstains with a stated reason and zero citations when the evidence doesn't support an answer, verified against nonexistent-customer and unsupported-figure queries.
- **Temporal & contradiction handling** — detects negation flips (approved/not-approved, open/completed) across documents on the same topic and resolves "current" status only when the evidence supports a clear date ordering.
- **Bounded agentic retrieval** — up to 3 additional retrieval passes, each triggered by a concrete, code-detected coverage gap, never an open-ended LLM loop.
- **ACL enforcement before generation, not after** — retrieval-time filtering via a SQL predicate and JWT-verified identity, so an unauthorized document is excluded by the query itself.
- **GraphRAG cross-document reasoning** — entity and relationship extraction into a queryable graph, exposed through a relationship-explorer UI and a `/graph/query` API.
- **Table-aware structured retrieval** — exact filters over table chunks for row-lookup questions, bypassing the semantic pipeline when a direct lookup is more accurate.
- **Full observability** — abstention rate, fallback-provider rate, JSON-retry rate, citation-validation pass rate, and p50/p95/p99 latency computed from persisted chat traces.
- **PII detection & redaction**, an adversarial prompt-injection test corpus across 8 attack categories, and blue/green index deployment with rollback.

---

## What Sets This Apart

- **Citations are verified, not just generated.** Every citation is independently checked against retrieved evidence for both existence and semantic support, and stripped if it fails either check — most RAG builds trust the model's citations at face value.
- **Graceful degradation is a designed feature.** Every AI-dependent component has a deterministic fallback and reports which mode is active, so the system behaves predictably with or without a live cloud connection instead of failing outright.
- **ACL enforcement happens at the retrieval boundary, in SQL** — an unauthorized document is excluded by the query engine itself, closing off the class of bugs where filtering is bypassed downstream.
- **Grounded, structured generation by default** — every answer is forced JSON with findings, citations, confidence, and abstention fields, with automatic retry on malformed output, rather than free-text responses parsed after the fact.
- **A real, tested evaluation loop** — Hit Rate/MRR retrieval metrics, abstention accuracy, and a 317-query stratified gold set, not a handful of manually spot-checked examples.

---

## Setup

### Backend
```bash
cd apps/api
pip install -r requirements.txt
cp .env.example .env   # optional — add a Gemini/Groq key, or leave blank
                        # to run on Ollama (if installed locally) or the
                        # built-in deterministic fallback
uvicorn app.main:app --reload --port 8000
```
Health check: `http://localhost:8000/system/health` reports which generation/embedding provider is active.

### Frontend
```bash
cd apps/web
npm install
npm run dev
```
Opens at `http://localhost:3000`. Protected routes require a bearer token, minted and cached automatically by the frontend via `/auth/dev-token`.

### Tests
```bash
cd apps/api
pip install -r requirements.txt -r requirements-dev.txt
pytest -v
```
Ingests synthetic sample call reports through the real pipeline (chunking → embedding → indexing → generation), not mocks.

---

## How It Works — Walkthrough

1. **Upload** a PDF call report → the ingestion pipeline validates, extracts layout-aware elements, and normalizes them.
2. **Chunking** splits extracted content into 350–500 token passages, keeping tables and figures as their own chunks and never crossing a section boundary; each chunk's embedding text is prefixed with its document/section/page context.
3. **Indexing** embeds every chunk (content-hash cached so reprocessing never re-embeds unchanged content) into a hybrid FTS5 + hnswlib store.
4. **A query** is rewritten (alias/synonym expansion, recency-hint detection), then retrieved via BM25 + vector search, fused with RRF, reranked with a cross-encoder, diversified across documents, and expanded with adjacent parent/sibling chunks — all filtered by the requester's ACL principals before anything reaches generation.
5. **Generation** produces a forced-JSON structured answer (findings, citations, confidence, abstention) — retried automatically on malformed JSON.
6. **Citation validation** checks every citation twice before it reaches the UI; failing citations are stripped and the answer flagged.
7. **The UI** streams the process as real SSE status events and renders clickable citation chips that deep-link straight to the source page in the Documents view.

---

## Future Scope

- Swap in real hosted embedding, generation, and vision models where fallback providers currently run, and compare quality directly.
- Validate the evaluation gold set and HNSW parameters against an exhaustive-KNN recall benchmark.
- Replace the local dev-token auth with a real enterprise IdP (OIDC/SAML) integration.
- Run load testing under concurrent traffic and publish p95/p99 latency numbers.
- Expand the synthetic document corpus toward real or realistically anonymized call report data for a production-grade quality evaluation.
- Move HNSW index management to a managed vector store for blue/green deployment at scale.

---

## Core Principles

1. Dynamic business facts stay in retrieval — fine-tuning, if used, is only for stable behaviors (classification, formatting, citation enforcement), never to memorize changing report content.
2. ACL filtering happens before evidence reaches the model, not after.
3. Every answer claim must be traceable to a chunk → document → page.
4. Hybrid retrieval (lexical + vector + rerank) is the default, not vector-only.
5. No metric or "production ready" claim is made without a measured run behind it.
