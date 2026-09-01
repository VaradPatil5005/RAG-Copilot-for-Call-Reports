"""GraphRAG query API (Phase 6.1, migrated to real auth in 6.3).

    POST /graph/query
      body: { question | predicate | node_id, max_hops? }
      returns: nodes, edges, and a source-chunk citation for every edge.

This is a *direct* graph query endpoint, separate from the Copilot's
`cross_document_graph` intent routing in `routers/copilot.py` (which
merges graph evidence into the normal generation path) -- this one is for
callers (the Knowledge Graph UI page) that want raw graph structure to
render, not a generated natural-language answer.

ACL enforcement here is identical to passage retrieval (`search_index.py`,
`db.acl_predicate_sql`) and, as of Phase 6.3, `tenant_id`/`principals` come
exclusively from the verified `identity` (`auth.require_identity`) -- never
from the request body. See `retrieval.py`'s `SearchRequest` docstring for
the same change and why it matters.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.services import audit, auth, graph_store, search_index

router = APIRouter(prefix="/graph", tags=["graph"])


class GraphQueryRequest(BaseModel):
    # Exactly one of these should be set; `question` is matched against a
    # small set of known query patterns (the blueprint's own examples),
    # not a full NL-to-graph-query model -- that ambiguity resolution is
    # bounded agentic retrieval's job (services/agentic_retrieval.py) when
    # this is reached via the Copilot's cross_document_graph intent.
    question: str | None = None
    predicate: str | None = None
    node_id: str | None = None
    max_hops: int = 2


def _route_question(question: str) -> str | None:
    q = question.lower()
    if "same competitor" in q or "competitor" in q:
        return "shared_competitor"
    return None


@router.post("/query")
def query_graph(req: GraphQueryRequest, identity: auth.Identity = Depends(auth.require_identity)) -> dict:
    tenant_id, principals = identity.tenant_id, identity.principals
    if req.node_id:
        result = graph_store.query_connected(req.node_id, tenant_id=tenant_id, principals=principals, max_hops=req.max_hops)
        mode = "connected"
    elif req.predicate:
        result = graph_store.query_by_predicate(req.predicate, tenant_id=tenant_id, principals=principals)
        mode = "predicate"
    elif req.question and _route_question(req.question) == "shared_competitor":
        result = graph_store.customers_sharing_competitor(tenant_id=tenant_id, principals=principals)
        mode = "shared_competitor"
    else:
        result = graph_store.query_by_predicate("MENTIONED_COMPETITOR", tenant_id=tenant_id, principals=principals)
        mode = "predicate_default"

    audit.record(
        endpoint="/graph/query",
        identity=identity,
        filters=search_index.SearchFilters(tenant_id=tenant_id, principals=principals),
        query=req.question or req.predicate or req.node_id,
        evidence_chunk_ids=[c["chunk_id"] for c in result.citations_by_edge.values()],
    )

    return {
        "mode": mode,
        "nodes": result.nodes,
        "edges": result.edges,
        "citations": result.citations_by_edge,
        "node_count": len(result.nodes),
        "edge_count": len(result.edges),
    }
