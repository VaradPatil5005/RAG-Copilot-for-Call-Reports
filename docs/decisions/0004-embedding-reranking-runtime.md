# 0004 — Embedding and reranking model runtime

## Status
Accepted, implemented.

## Context
Phase 3 needs a local substitute for Azure OpenAI embeddings and Azure AI
Search's semantic reranker. Two implementation paths were available:
`sentence-transformers` (PyTorch) or `fastembed` (ONNX Runtime).

## Decision
Use **`fastembed`** (Qdrant's library), not `sentence-transformers`. This
is deliberate, not incidental, and should not be re-litigated or
"discovered" as an oversight later:

- `sentence-transformers` pulls in PyTorch, which is a multi-GB install
  and (without a GPU, which this dev environment does not have) leaves
  every embedding call running on CPU via a much heavier runtime than the
  computation needs.
- `fastembed` runs models through **ONNX Runtime** instead — tens of MB,
  not gigabytes, no CUDA requirement, CPU-friendly by design rather than
  as a fallback mode.
- Both the embedding model (`BAAI/bge-small-en-v1.5`, 384 dimensions) and
  the reranker (`Xenova/ms-marco-MiniLM-L-6-v2`, a cross-encoder) are
  ONNX-based through `fastembed`, so there is no PyTorch anywhere in the
  retrieval stack.
- `requirements.txt` gains only `fastembed` (which pulls in `onnxruntime`
  automatically) — no separate PyTorch or CUDA dependency line.

Both are wrapped behind the `EmbeddingProvider` protocol
(`services/embeddings.py`) — `embed_texts`, `model_name`, `dimensions` —
so an Azure OpenAI (or OpenAI-direct) provider can be dropped in later
with zero changes to `chunking.py`, `search_index.py`, or any future
Phase 4 Copilot code that consumes embeddings.

## A second decision this ADR needs to be honest about: the sandbox fallback

`fastembed` downloads its ONNX model weights from Hugging Face on first
use. **This development sandbox's network egress allowlist does not
include `huggingface.co`** (see the container's network configuration —
only PyPI/npm/GitHub-adjacent hosts are reachable). Attempting to
initialize `FastEmbedProvider` here fails with a 403 after retries.

Rather than either (a) silently shipping a retrieval engine that can't
actually be exercised end-to-end in this environment, or (b) quietly
swapping in a different "equivalent" library without saying so, both
`services/embeddings.py` and `services/search_index.py` implement this
explicitly:

- `FastEmbedProvider` / the real `TextCrossEncoder` are tried **first**,
  always. This is the supported, documented runtime path and is what
  runs automatically on any machine with normal internet access.
- Only if model download fails does the code fall back to a **local,
  dependency-free, deterministic substitute** —
  `HashingEmbeddingProvider` (feature-hashed, L2-normalized bag-of-words
  vectors) for embeddings, and a lexical-overlap scorer for reranking.
- The fallback is never silent: it logs a warning naming exactly what
  failed and why, `provider_is_fallback()` / `reranker_is_fallback()`
  expose the state programmatically, and it's surfaced in
  `/system/health`, the per-document processing manifest
  (`embedding.fallback: true/false`), and the `/search` and `/retrieval`
  trace payloads (`embedding_provider`, `reranker_provider`).

This fallback exists **only** so chunking → embedding → vector indexing →
RRF → reranking → parent-child expansion could be built and verified as a
real, working pipeline against the sample PDFs in this sandbox, not as a
recommendation. It is explicitly called out in code comments and here so
it is never mistaken for the intended production or even normal-dev-
machine behavior. On a machine with `huggingface.co` reachable (i.e. any
normal dev laptop or CI runner without an unusual egress allowlist),
`get_default_provider()` and `_get_reranker()` will use real `fastembed`
models automatically with no code change — the `try FastEmbedProvider
first` structure is exactly what makes that automatic.

## Consequences
- Retrieval quality numbers produced in *this* sandbox (recall, MRR,
  semantic relevancy) are not meaningful — they reflect the hashing
  fallback, not `BAAI/bge-small-en-v1.5`. Any evaluation run against the
  Phase 3 gold-query set must first confirm
  `embeddings.provider_is_fallback() is False` (surfaced in
  `/system/health`), or the numbers should be discarded.
- The hashing/lexical-overlap fallback is intentionally simple and not
  tuned — it exists to prove the pipeline's plumbing (candidates flow
  correctly through chunking → embedding → indexing → RRF → rerank →
  diversify → expand), not to approximate `bge-small`'s semantic
  behavior. Don't extend it; if `fastembed` is unreachable in a target
  environment, fix network egress rather than investing in the fallback.

## Revisit when
This code runs anywhere with standard internet access (which is expected
for actual local dev and for CI/production) — at that point
`FastEmbedProvider` and the real cross-encoder load automatically and
this ADR's fallback path is dead code that stays only as a safety net,
not something to remove, since a model host outage should degrade rather
than crash ingestion.
