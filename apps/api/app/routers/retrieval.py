"""Retrieval API -- hybrid search over indexed chunks.

    POST /search     -> ranked results with per-stage scores, for the
                         Search page in the UI.
    POST /retrieval   -> final assembled context (post-rerank, post-
                         diversify, post-parent-expansion) -- what Phase 4's
                         Copilot will consume directly.

Both endpoints log a retrieval trace (query, filters, candidate counts per
stage, final chunk_ids) so a trace can be reconstructed later without a
full observability system (that's Phase 6).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.services import audit, auth, query_rewrite, search_index, temporal

logger = logging.getLogger("retrieval.api")

router = APIRouter(tags=["retrieval"])


class SearchFiltersIn(BaseModel):
    customer: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    document_id: str | None = None


class SearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=10, ge=1, le=search_index.FINAL_CONTEXT_MAX)
    filters: SearchFiltersIn | None = None
    max_per_document: int = search_index.DEFAULT_MAX_PER_DOCUMENT
    max_per_section: int = search_index.DEFAULT_MAX_PER_SECTION
    # Phase 5: apply query_rewrite's alias/acronym expansion before search.
    rewrite: bool = True
    # Phase 6.3: tenant_id and principals are NOT accepted here anymore --
    # ADR 0006 documented that as a local-dev shortcut; ADR 0007 replaces
    # it. Both now come exclusively from the verified `identity` (see
    # `auth.require_identity`), never from anything the client puts in the
    # request body. A stray "tenant_id"/"principals" key in a request body
    # is simply ignored by Pydantic (extra fields default to "ignore"),
    # which is itself the point: there's nothing left for a forged value
    # in the body to do.


def _to_filters(req: SearchRequest, identity: auth.Identity) -> search_index.SearchFilters:
    f = req.filters or SearchFiltersIn()
    return search_index.SearchFilters(
        customer=f.customer,
        date_from=f.date_from,
        date_to=f.date_to,
        document_id=f.document_id,
        tenant_id=identity.tenant_id,
        principals=identity.principals,
    )


def _resolve_query(req: SearchRequest) -> tuple[str, query_rewrite.RewriteResult | None]:
    if not req.rewrite:
        return req.query, None
    rw = query_rewrite.rewrite_query(req.query)
    return rw.rewritten_query, rw


def _result_out(c: dict) -> dict:
    return {
        "chunk_id": c["chunk_id"],
        "document_id": c["document_id"],
        "version": c.get("version"),
        "chunk_type": c.get("chunk_type"),
        "customer_name": c.get("customer_name"),
        "account_owner": c.get("account_owner"),
        "meeting_date": c.get("meeting_date"),
        "section_path": c.get("section_path") or [],
        "page_number": c.get("page_number"),
        "snippet": (c.get("raw_text") or "")[:500],
        "table_json": c.get("table_json"),
        "bm25_score": c.get("bm25_score"),
        "vector_score": c.get("vector_score"),
        "rrf_score": c.get("rrf_score"),
        "rerank_score": c.get("rerank_score"),
        "is_expansion": c.get("is_expansion", False),
    }


@router.post("/search")
def search(req: SearchRequest, identity: auth.Identity = Depends(auth.require_identity)) -> dict:
    filters = _to_filters(req, identity)
    query_used, rw = _resolve_query(req)
    results, trace = search_index.hybrid_search(
        query_used,
        top_k=req.top_k,
        filters=filters,
        max_per_document=req.max_per_document,
        max_per_section=req.max_per_section,
    )
    logger.info("search trace: %s", trace)
    audit.record(
        endpoint="/search",
        identity=identity,
        filters=filters,
        query=req.query,
        evidence_chunk_ids=[c["chunk_id"] for c in results],
    )
    return {
        "query": req.query,
        "query_used": query_used,
        "query_rewrite": {
            "intent_mode": rw.intent_mode,
            "expansions": rw.expansions,
            "recency_hint": rw.recency_hint,
            "detected_entities": rw.detected_entities,
        }
        if rw
        else None,
        "results": [_result_out(c) for c in results],
        "trace": {
            "bm25_candidates": trace.bm25_candidate_count,
            "vector_candidates": trace.vector_candidate_count,
            "fused_candidates": trace.fused_candidate_count,
            "reranked_candidates": trace.reranked_count,
            "diversified_candidates": trace.diversified_count,
            "final_count": trace.final_count,
            "embedding_provider": trace.embedding_provider,
            "reranker_provider": trace.reranker_provider,
        },
    }


@router.post("/retrieval")
def retrieval(req: SearchRequest, identity: auth.Identity = Depends(auth.require_identity)) -> dict:
    filters = _to_filters(req, identity)
    query_used, rw = _resolve_query(req)
    results, trace = search_index.retrieve_context(query_used, top_k=req.top_k, filters=filters)
    logger.info("retrieval trace: %s", trace)
    evidence = [_result_out(c) for c in results]
    audit.record(
        endpoint="/retrieval",
        identity=identity,
        filters=filters,
        query=req.query,
        evidence_chunk_ids=[c["chunk_id"] for c in results],
    )
    temporal_analysis = temporal.analyze(results)
    return {
        "query": req.query,
        "query_used": query_used,
        "evidence": evidence,
        "evidence_count": len(evidence),
        "contradictions": [c.__dict__ for c in temporal_analysis.contradictions],
        "latest_document_id": temporal_analysis.latest_document_id,
        "latest_meeting_date": temporal_analysis.latest_meeting_date,
        "trace": {
            "bm25_candidates": trace.bm25_candidate_count,
            "vector_candidates": trace.vector_candidate_count,
            "fused_candidates": trace.fused_candidate_count,
            "reranked_candidates": trace.reranked_count,
            "diversified_candidates": trace.diversified_count,
            "final_count": trace.final_count,
            "final_chunk_ids": trace.final_chunk_ids,
            "embedding_provider": trace.embedding_provider,
            "reranker_provider": trace.reranker_provider,
        },
    }


class TableLookupRequest(BaseModel):
    filters: SearchFiltersIn | None = None
    row_contains: str | None = None
    limit: int = 25


@router.post("/retrieval/table-lookup")
def table_lookup(req: TableLookupRequest, identity: auth.Identity = Depends(auth.require_identity)) -> dict:
    """Table-aware structured retrieval (blueprint Section 4.2) -- exact
    filters over table chunks, bypassing semantic ranking. For questions
    like "show all reports where pipeline exceeded $1M" this beats hybrid
    search, which is optimized for narrative recall, not exact row lookup."""
    f = req.filters or SearchFiltersIn()
    filters = search_index.SearchFilters(
        customer=f.customer,
        date_from=f.date_from,
        date_to=f.date_to,
        document_id=f.document_id,
        tenant_id=identity.tenant_id,
        principals=identity.principals,
    )
    rows = search_index.structured_table_search(filters, row_contains=req.row_contains, limit=req.limit)
    audit.record(
        endpoint="/retrieval/table-lookup",
        identity=identity,
        filters=filters,
        query=req.row_contains,
        evidence_chunk_ids=[c["chunk_id"] for c in rows],
    )
    return {"results": [_result_out(c) for c in rows], "count": len(rows)}


@router.post("/search/reindex")
def reindex() -> dict:
    """Phase 6.5: a real blue/green reindex -- builds a brand-new index
    version from `chunks` while the currently-active index keeps serving
    every live search unaffected, then atomically switches the alias.
    The previous version's files are left on disk (see
    `/search/index-versions`) so `/search/rollback` can revert instantly."""
    return search_index.rebuild_index_blue_green()


@router.get("/search/index-versions")
def index_versions() -> dict:
    return {"versions": search_index.list_index_versions()}


class RollbackRequest(BaseModel):
    to_version: str


@router.post("/search/rollback")
def rollback(req: RollbackRequest) -> dict:
    return search_index.rollback_active_index(req.to_version)
