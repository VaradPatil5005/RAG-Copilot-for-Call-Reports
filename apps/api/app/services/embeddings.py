"""Embedding service -- local substitute for Azure OpenAI embeddings.

Uses `fastembed` (ONNX Runtime), not `sentence-transformers`/PyTorch --
deliberately, to avoid a multi-GB PyTorch install on a local dev machine
with no GPU. See docs/decisions/0004-embedding-reranking-runtime.md for
the full reasoning and for why a deterministic fallback provider also
exists in this module.

Everything is behind the `EmbeddingProvider` protocol so an Azure OpenAI
(or OpenAI-direct) provider can be dropped in later with zero changes to
calling code in chunking/search_index/retrieval.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import threading
from typing import Protocol

logger = logging.getLogger("retrieval.embeddings")

FASTEMBED_MODEL_NAME = "BAAI/bge-small-en-v1.5"
FASTEMBED_DIMENSIONS = 384

RERANK_MODEL_NAME = "Xenova/ms-marco-MiniLM-L-6-v2"


class EmbeddingProvider(Protocol):
    def embed_texts(self, texts: list[str]) -> list[list[float]]: ...

    @property
    def model_name(self) -> str: ...

    @property
    def dimensions(self) -> int: ...


class FastEmbedProvider:
    """Primary provider -- wraps `fastembed.TextEmbedding` running
    BAAI/bge-small-en-v1.5 in ONNX Runtime (384 dims). Downloads ONNX
    weights on first use (a few hundred MB) and caches them locally.
    Batches internally via fastembed's `.embed()` iterable API rather than
    embedding one chunk at a time.
    """

    def __init__(self, model_name: str = FASTEMBED_MODEL_NAME) -> None:
        from fastembed import TextEmbedding  # local import: keeps module import light

        self._model = TextEmbedding(model_name=model_name)
        self._model_name = model_name

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return [vec.tolist() for vec in self._model.embed(texts)]

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def dimensions(self) -> int:
        return FASTEMBED_DIMENSIONS


_WORD_RE = re.compile(r"[a-z0-9]+")


class HashingEmbeddingProvider:
    """Deterministic, dependency-free fallback -- NOT a substitute for real
    dense embeddings, and not the recommended path (see ADR 0004). This
    sandbox has no network route to huggingface.co, so `FastEmbedProvider`
    cannot download its ONNX weights here. Rather than fail the whole
    retrieval engine (or silently pretend to use fastembed), embeddings
    fall back to feature-hashed, L2-normalized bag-of-words vectors so
    vector search, RRF, and parent-child expansion remain exercisable
    end-to-end in this environment. Any dev machine with normal internet
    access gets real `FastEmbedProvider` automatically -- see
    `get_default_provider()` below.
    """

    def __init__(self, dimensions: int = FASTEMBED_DIMENSIONS) -> None:
        self._dimensions = dimensions
        self._model_name = "local-hashing-fallback-v1"

    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self._dimensions
        for tok in _WORD_RE.findall(text.lower()):
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
            idx = h % self._dimensions
            sign = 1.0 if (h // self._dimensions) % 2 == 0 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def dimensions(self) -> int:
        return self._dimensions


_provider_lock = threading.Lock()
_provider: EmbeddingProvider | None = None
_provider_is_fallback = False


def get_default_provider() -> EmbeddingProvider:
    """Try FastEmbedProvider first (the supported production path). Falls
    back to HashingEmbeddingProvider only if model download fails (e.g. no
    network route to huggingface.co), logging loudly so this is never a
    silent degrade. Cached process-wide -- ONNX Runtime session init is not
    free."""
    global _provider, _provider_is_fallback
    with _provider_lock:
        if _provider is not None:
            return _provider
        try:
            _provider = FastEmbedProvider()
            _provider_is_fallback = False
            logger.info("Embedding provider: fastembed (%s)", FASTEMBED_MODEL_NAME)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "fastembed model download failed (%s) -- falling back to "
                "HashingEmbeddingProvider. This is a local-sandbox degrade, "
                "not the recommended runtime; see ADR 0004.",
                exc,
            )
            _provider = HashingEmbeddingProvider()
            _provider_is_fallback = True
        return _provider


def provider_is_fallback() -> bool:
    get_default_provider()
    return _provider_is_fallback


_embed_cache: dict[str, list[float]] = {}
_embed_cache_lock = threading.Lock()


def embed_with_cache(texts_by_hash: dict[str, str]) -> dict[str, list[float]]:
    """Batch-embed content keyed by content_hash, skipping hashes already
    cached (mirrors the ingestion pipeline's idempotency principle -- an
    unchanged chunk is never re-embedded on reprocessing)."""
    provider = get_default_provider()
    with _embed_cache_lock:
        missing = {h: t for h, t in texts_by_hash.items() if h not in _embed_cache}
    if missing:
        hashes = list(missing.keys())
        vectors = provider.embed_texts([missing[h] for h in hashes])
        with _embed_cache_lock:
            for h, v in zip(hashes, vectors):
                _embed_cache[h] = v
    with _embed_cache_lock:
        return {h: _embed_cache[h] for h in texts_by_hash}
