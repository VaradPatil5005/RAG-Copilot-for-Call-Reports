# ADR 0001 — Local-dev substitutions for Azure services

Status: Accepted (Phase 1)

## Context

The target production architecture (see the two source blueprint PDFs) is
built entirely on Azure: ADLS Gen2, Event Grid, Service Bus, Azure AI
Document Intelligence Layout, Azure AI Search (BM25 + HNSW + RRF + semantic
ranker), and Azure OpenAI GPT-4o Mini.

No Azure subscription exists yet. Building nothing until one exists would
stall the project for 8 weeks. Instead, every Azure service is replaced with
a local equivalent that preserves the same **interface and behavior
contract**, so the swap to real Azure later is a configuration and adapter
change, not an architectural rewrite.

## Substitution map

| Azure service | Local substitute | Notes |
|---|---|---|
| ADLS Gen2 (raw + derived zones) | Local filesystem: `apps/api/data/raw`, `apps/api/data/derived` | Same immutability + versioning discipline enforced in code, not by the storage layer |
| Event Grid + Service Bus | In-process async queue (Phase 2) | No durability across restarts; acceptable for local dev, not for production |
| Document Intelligence Layout | PyMuPDF / pdfplumber extraction service (Phase 2) | Weaker table/figure structure recognition than Azure's model — flagged wherever extraction quality matters |
| Azure AI Search (hybrid BM25+HNSW+RRF+semantic) | `rank-bm25` for lexical + a local vector index (e.g. `faiss` or `hnswlib`) for dense retrieval, RRF implemented directly (Phase 3) | HNSW parameter tuning still applies; semantic reranking substituted with a cross-encoder or omitted until Azure semantic ranker is available |
| Azure OpenAI GPT-4o Mini | Pluggable LLM client interface; provider selected via env config (Phase 4) | Must support the same evidence-only, citation-enforced prompting contract regardless of provider |
| Key Vault / Managed Identity | `.env` file, **never committed** | Real secret management is a Phase 6 requirement before anything resembling "production ready" |

## Consequences

- Every substitution lives behind an interface in `services/` so later Azure
  integration touches adapters, not calling code.
- Claims of "production readiness" do not apply until the real Azure
  services are wired in and the Phase 6 acceptance criteria are re-verified
  against them — local-dev equivalents are for development velocity only.
- Performance/capacity numbers measured locally (latency, recall) are not
  representative of Azure AI Search's actual HNSW implementation and should
  not be reported as such in the evaluation framework.

## Revisit when

An Azure subscription becomes available. At that point, work through this
table top to bottom, replacing each substitute with its real counterpart,
and re-run the Phase 2/3 exit criteria against the real services before
claiming any phase is "done" in the Azure sense.
