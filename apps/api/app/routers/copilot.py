"""Copilot chat API (Phase 4).

    POST /chat
      body: { query, conversation_id?, filters?, tenant_id? }
      returns: text/event-stream (SSE) of:
        - {"type": "status", "stage": ...}
        - {"type": "token", "text": ...}       (simulated streaming of the
          final answer text -- see note below on why)
        - {"type": "final", "answer": {...}, "citation_validation": {...},
           "model_name": ..., "trace_id": ...}
        - {"type": "error", "message": ...}

Why "simulated" token streaming: the generation contract requires a single
valid structured JSON object (answer/key_findings/citations/confidence/
abstained), and none of the wired providers (Gemini/Groq/Ollama JSON mode,
or the extractive fallback) can safely stream *partial* JSON token-by-token
without risking an unparseable fragment reaching the citation validator.
So generation runs as one call, and the `answer` field is then streamed to
the frontend in word-sized chunks -- real backend work (retrieval,
generation, citation validation) drives the SSE status events in real
time; only the final answer's *text delivery* is chunked for UX. This is
called out explicitly rather than pretending it's raw model token
streaming.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import db
from app.observability import instrumentation
from app.routing import query_router
from app.services import agentic_retrieval, audit, auth, citation_validator, generation, graph_store, pii, search_index, temporal

logger = logging.getLogger("copilot.api")

router = APIRouter(tags=["copilot"])


class ChatFiltersIn(BaseModel):
    customer: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    document_id: str | None = None


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    evidence_chunk_ids: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    query: str
    conversation_id: str | None = None
    filters: ChatFiltersIn | None = None
    messages: list[ChatMessage] | None = None
    is_incognito: bool | None = False
    # Phase 6.3: tenant_id/principals no longer accepted here -- both come
    # exclusively from the verified `identity` (see `auth.require_identity`).
    # See retrieval.py's SearchRequest docstring for the same change.


_FOLLOW_UP_TRIGGERS = (
    "elaborate",
    "ellaborate",
    "expand",
    "tell me more",
    "more detail",
    "more details",
    "explain more",
    "explain further",
    "further detail",
    "further clarify",
    "clarify",
    "continue",
    "go on",
    "what else",
    "deep dive",
    "break it down",
    "break down",
    "above answer",
    "above anser",
    "previous answer",
    "prior answer",
    "earlier answer",
    "give more",
    "provide more",
    "what about that",
    "why was that",
    "why is that",
    "how does that",
)


def _is_follow_up_query(query: str, has_prior_context: bool) -> bool:
    """Detects whether a user query is a conversational follow-up or elaboration
    referencing a preceding turn rather than an independent standalone question."""
    if not has_prior_context:
        return False
    q = query.strip().lower()
    if any(trigger in q for trigger in _FOLLOW_UP_TRIGGERS):
        return True
    words = [w for w in re.findall(r"[a-z0-9]+", q) if w]
    if len(words) <= 4 and any(
        w in ("why", "how", "details", "explain", "more", "that", "this", "it", "who", "which") for w in words
    ):
        return True
    return False


def _get_conversation_context(
    req: ChatRequest,
    tenant_id: str,
) -> tuple[str | None, str | None, list[str]]:
    """Resolves prior turn context (previous_query, previous_answer, prior_chunk_ids).
    Traverses back past intermediate follow-ups (e.g. 'elaborate') to locate the root
    substantive topic query so multi-turn follow-up chains retain full grounding."""
    prev_query: str | None = None
    prev_answer: str | None = None
    prior_chunk_ids: list[str] = []

    if req.messages:
        for msg in reversed(req.messages):
            if msg.role == "assistant" and not prev_answer:
                prev_answer = msg.content
                if msg.evidence_chunk_ids:
                    prior_chunk_ids.extend(msg.evidence_chunk_ids)
            elif msg.role == "user" and prev_answer:
                if not prev_query or _is_follow_up_query(prev_query, has_prior_context=True):
                    prev_query = msg.content
                    if not _is_follow_up_query(msg.content, has_prior_context=True):
                        break

    if (not prev_query or _is_follow_up_query(prev_query, has_prior_context=True)) and req.conversation_id:
        try:
            conn = db.get_connection()
            rows = conn.execute(
                """
                SELECT query, answer_json, retrieved_chunk_ids
                FROM chat_traces
                WHERE conversation_id = ? AND tenant_id = ?
                ORDER BY created_at DESC
                LIMIT 10
                """,
                (req.conversation_id, tenant_id),
            ).fetchall()
            for row in rows:
                ans_obj = db.loads(row[1], {})
                if not prev_answer and isinstance(ans_obj, dict):
                    prev_answer = ans_obj.get("answer") or ""
                chunk_list = db.loads(row[2], [])
                if chunk_list:
                    prior_chunk_ids.extend([cid for cid in chunk_list if cid not in prior_chunk_ids])
                q = row[0]
                if not prev_query or _is_follow_up_query(prev_query, has_prior_context=True):
                    prev_query = q
                    if not _is_follow_up_query(q, has_prior_context=True):
                        break
        except Exception:
            logger.exception("Failed to load prior conversation trace for conversation_id=%s", req.conversation_id)

    return prev_query, prev_answer, prior_chunk_ids


# --- Intent classification (Phase 4 scope -- see spec section 5) -----------
# Deliberately simple heuristics, not a model call: distinguishes only what
# this phase needs (top_k sizing + a UI hint). Full taxonomy and bounded
# agentic multi-pass retrieval are Phase 5.

_MULTI_DOC_HINTS = (
    "which customers", "across", "compare", "both", "all reports",
    "every customer", "each customer", "customers mentioned", "who else",
)
_UNANSWERABLE_HINTS = (
    "revenue", "stock price", "headcount", "employee count", "market cap",
)
# Phase 6.1: the blueprint's own cross_document_graph examples -- checked
# before the multi-doc hints since some overlap ("across", "which
# customers"), and a graph-shaped question needs graph evidence, not just
# a wider passage-retrieval top_k.
_GRAPH_HINTS = (
    "same competitor", "mention the same", "unresolved actions across",
    "connect this account", "connected to other accounts", "shared competitor",
)


def classify_intent(query: str) -> str:
    q = query.lower()
    if any(h in q for h in _GRAPH_HINTS):
        return "cross_document_graph"
    if any(h in q for h in _MULTI_DOC_HINTS):
        return "likely_needs_multiple_documents"
    if any(h in q for h in _UNANSWERABLE_HINTS):
        return "likely_unanswerable"
    return "answerable_single_pass"


_TOP_K_BY_INTENT = {
    "answerable_single_pass": 8,
    "likely_needs_multiple_documents": 14,
    "likely_unanswerable": 10,
    "cross_document_graph": 14,
}


def _graph_evidence(filters: search_index.SearchFilters) -> list[dict]:
    """cross_document_graph routing (Phase 6.1): traverse the graph store
    (already ACL-filtered -- see graph_store.py), then resolve every
    traversed edge's source chunk through the *same* ACL-enforcing
    chokepoint passage retrieval uses (`search_index._fetch_chunk_rows`),
    so a graph edge can never smuggle in evidence a passage query
    couldn't also see. Returned evidence dicts match the same shape
    `hybrid_search`/`expand_parent_child` produce, so generation never
    knows whether a chunk arrived via graph traversal or passage
    retrieval -- one generation path, per the Phase 6 spec."""
    result = graph_store.customers_sharing_competitor(tenant_id=filters.tenant_id, principals=filters.principals)
    chunk_ids = list({c["chunk_id"] for c in result.citations_by_edge.values()})
    if not chunk_ids:
        return []
    rows_by_id = search_index._fetch_chunk_rows(chunk_ids, filters)  # same ACL chokepoint as passage retrieval
    return list(rows_by_id.values())


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _to_filters(req: ChatRequest, identity: auth.Identity) -> search_index.SearchFilters:
    f = req.filters or ChatFiltersIn()
    return search_index.SearchFilters(
        customer=f.customer,
        date_from=f.date_from,
        date_to=f.date_to,
        document_id=f.document_id,
        tenant_id=identity.tenant_id,
        principals=identity.principals,
    )


def _evidence_out(c: dict) -> dict:
    return {
        "chunk_id": c["chunk_id"],
        "document_id": c["document_id"],
        "page_number": c.get("page_number"),
        "section_path": c.get("section_path") or [],
        "snippet": (c.get("raw_text") or "")[:300],
    }


def _persist_trace(
    *,
    trace_id: str,
    conversation_id: str | None,
    tenant_id: str,
    query: str,
    intent: str,
    retrieved_chunk_ids: list[str],
    answer_json: dict,
    validation_summary: dict,
    model_name: str,
    provider_is_fallback: bool,
    json_retry_used: bool,
    latency_ms: int,
    usage: dict | None = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    # Phase 6.5: redact PII from the free-text fields before they ever
    # reach persistent telemetry -- see services/pii.py's module
    # docstring for why this applies here and not to chunk content.
    logged_query = pii.redact_for_logging(query)
    logged_answer_json = dict(answer_json)
    if logged_answer_json.get("answer"):
        logged_answer_json["answer"] = pii.redact_for_logging(logged_answer_json["answer"])
    if logged_answer_json.get("key_findings"):
        logged_answer_json["key_findings"] = [pii.redact_for_logging(k) for k in logged_answer_json["key_findings"]]
    usage = usage or {}
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO chat_traces (
                trace_id, conversation_id, tenant_id, query, intent,
                retrieved_chunk_ids, answer_json, citation_validation,
                model_name, provider_is_fallback, json_retry_used,
                confidence, abstained, latency_ms,
                prompt_tokens, completion_tokens, total_tokens, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                conversation_id,
                tenant_id,
                logged_query,
                intent,
                db.dumps(retrieved_chunk_ids),
                db.dumps(logged_answer_json),
                db.dumps(validation_summary),
                model_name,
                1 if provider_is_fallback else 0,
                1 if json_retry_used else 0,
                answer_json.get("confidence"),
                1 if answer_json.get("abstained") else 0,
                latency_ms,
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
                usage.get("total_tokens"),
                now,
            ),
        )


def _word_chunks(text: str, size: int = 4) -> list[str]:
    words = text.split(" ")
    out = []
    for i in range(0, len(words), size):
        out.append(" ".join(words[i : i + size]))
    return out


async def _chat_stream(req: ChatRequest, identity: auth.Identity):
    start = time.monotonic()
    trace_id = f"trace-{uuid.uuid4().hex[:12]}"

    # feature/decision-intelligence-layer, Phase C (additive): per-stage
    # elapsed time, persisted alongside (never in place of) the existing
    # single end-to-end `latency_ms` chat_traces already records. Purely
    # a local bookkeeping list until persisted near the end of this
    # function; adds no behavior to the stages themselves.
    _stage_clock = start
    stage_timings: list[tuple[str, int]] = []

    def _mark_stage(stage_name: str) -> None:
        nonlocal _stage_clock
        now = time.monotonic()
        stage_timings.append((stage_name, int((now - _stage_clock) * 1000)))
        _stage_clock = now

    yield _sse({"type": "status", "stage": "understanding_query"})

    # Multi-turn conversation context resolution
    prev_query, prev_answer, prior_chunk_ids = _get_conversation_context(req, identity.tenant_id)
    is_follow_up = _is_follow_up_query(req.query, has_prior_context=bool(prev_query and prev_answer))

    retrieval_query = req.query
    if is_follow_up and prev_query:
        # Reformulate retrieval query so hybrid search & agentic retrieval locate relevant call report passages
        retrieval_query = f"{prev_query} — {req.query}"

    intent = classify_intent(retrieval_query)
    top_k = _TOP_K_BY_INTENT.get(intent, 10)

    # feature/decision-intelligence-layer, Phase A (additive): the new
    # Query Router runs alongside -- never in place of -- the existing
    # `classify_intent` above. It never affects `top_k` or removes any
    # existing retrieval path; wrapped so a failure here can never break
    # the existing chat flow. See app/routing/query_router.py.
    route_decision: query_router.QueryRouteDecision | None = None
    try:
        route_decision = query_router.classify_query(retrieval_query)
    except Exception:  # noqa: BLE001
        logger.exception("query router classification failed (non-fatal)")

    _mark_stage("understanding_query")
    yield _sse({"type": "status", "stage": "retrieving_evidence"})

    filters = _to_filters(req, identity)
    graph_evidence_count = 0
    try:
        agentic_result = agentic_retrieval.run(retrieval_query, top_k=top_k, filters=filters)
        evidence = agentic_result.evidence
        retrieval_trace = agentic_result.trace

        # If this is an elaboration/follow-up turn, merge prior evidence chunks so
        # the model has the exact ground-truth source passages from the preceding answer
        if is_follow_up and prior_chunk_ids:
            try:
                prior_rows = search_index._fetch_chunk_rows(prior_chunk_ids, filters)
                existing_ids = {c["chunk_id"] for c in evidence}
                for cid, chunk in prior_rows.items():
                    if cid not in existing_ids:
                        evidence.append(chunk)
                        existing_ids.add(cid)
            except Exception:
                logger.exception("failed to merge prior evidence chunks (non-fatal)")

        if intent == "cross_document_graph":
            graph_evidence = _graph_evidence(filters)
            existing_ids = {c["chunk_id"] for c in evidence}
            merged = [c for c in graph_evidence if c["chunk_id"] not in existing_ids]
            graph_evidence_count = len(merged)
            evidence = evidence + merged
    except Exception as exc:  # noqa: BLE001
        logger.exception("retrieval failed")
        # feature/decision-intelligence-layer, Phase C (additive): persist
        # to the new failure log -- the SSE error event below still fires
        # exactly as before; this only adds a queryable record of it.
        try:
            instrumentation.record_failure(
                trace_id=trace_id,
                conversation_id=req.conversation_id,
                tenant_id=identity.tenant_id,
                stage="retrieving_evidence",
                query=req.query,
                error_message=str(exc),
            )
        except Exception:  # noqa: BLE001
            logger.exception("failed to persist chat trace failure for %s", trace_id)
        yield _sse({"type": "error", "message": f"Retrieval failed: {exc}"})
        return

    # feature/decision-intelligence-layer, Phase A (additive): if the
    # router flags this as a graph-relationship question that the
    # existing `classify_intent` heuristic didn't already route through
    # GraphRAG, ADD (never replace/reorder) the same graph evidence the
    # existing `cross_document_graph` intent path already fetches, via
    # the same ACL-enforcing chokepoint (`_graph_evidence`). Any
    # existing query that already scores `cross_document_graph` is
    # unaffected -- this only ever adds evidence for queries the
    # existing classifier previously routed with zero graph evidence.
    if (
        route_decision is not None
        and route_decision.category == "graph_relationship"
        and intent != "cross_document_graph"
    ):
        try:
            router_graph_evidence = _graph_evidence(filters)
            existing_ids = {c["chunk_id"] for c in evidence}
            router_merged = [c for c in router_graph_evidence if c["chunk_id"] not in existing_ids]
            graph_evidence_count += len(router_graph_evidence)
            evidence = evidence + router_merged
        except Exception:  # noqa: BLE001
            logger.exception("router-triggered graph evidence fetch failed (non-fatal)")

    temporal_analysis = temporal.analyze(evidence)

    _mark_stage("retrieving_evidence")
    yield _sse(
        {
            "type": "status",
            "stage": "reasoning",
            "detail": {
                "intent": intent,
                "evidence_count": len(evidence),
                "embedding_provider": retrieval_trace.embedding_provider if retrieval_trace else None,
                "retrieval_passes": len(agentic_result.passes),
                "query_rewrite_expansions": agentic_result.rewrite.expansions if agentic_result.rewrite else [],
                "contradictions_detected": len(temporal_analysis.contradictions),
                "graph_evidence_count": graph_evidence_count,
                "query_router": route_decision.to_dict() if route_decision else None,
            },
        }
    )

    _mark_stage("reasoning")
    yield _sse({"type": "status", "stage": "generating"})

    try:
        gen_result = generation.generate_structured_answer(
            req.query,
            evidence,
            tenant_id=identity.tenant_id,
            query_category=route_decision.category if route_decision else None,
            previous_query=prev_query if is_follow_up else None,
            previous_answer=prev_answer if is_follow_up else None,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("generation failed")
        try:
            instrumentation.record_failure(
                trace_id=trace_id,
                conversation_id=req.conversation_id,
                tenant_id=identity.tenant_id,
                stage="generating",
                query=req.query,
                error_message=str(exc),
            )
        except Exception:  # noqa: BLE001
            logger.exception("failed to persist chat trace failure for %s", trace_id)
        yield _sse({"type": "error", "message": f"Generation failed: {exc}"})
        return

    _mark_stage("generating")
    yield _sse({"type": "status", "stage": "validating"})

    validation = citation_validator.validate(gen_result.raw_json, evidence)
    final_answer = validation.answer_json
    validation_summary = validation.summary

    # Phase E (Self-Learning Decision Intelligence Copilot, additive):
    # Record verified retrieval & citation outcomes to adjust chunk utility multipliers.
    try:
        from app.services import learning

        citations = final_answer.get("citations", [])
        cited_cids = [c["chunk_id"] for c in citations if c.get("chunk_id")]
        failed_checks = [
            c.chunk_id for c in validation.checks if not c.support_ok or not c.existence_ok
        ]
        learning.record_retrieval_and_validation_outcomes(
            retrieved_chunk_ids=[c["chunk_id"] for c in evidence],
            cited_chunk_ids=cited_cids,
            failed_chunk_ids=failed_checks,
            tenant_id=identity.tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("Failed to record learning outcomes (non-fatal): %s", exc)

    # Stream the answer text as word chunks -- see module docstring.
    answer_text = final_answer.get("answer") or ""
    for chunk in _word_chunks(answer_text):
        yield _sse({"type": "token", "text": chunk + " "})

    _mark_stage("validating")
    latency_ms = int((time.monotonic() - start) * 1000)

    try:
        _persist_trace(
            trace_id=trace_id,
            conversation_id=req.conversation_id,
            tenant_id=identity.tenant_id,
            query=req.query,
            intent=intent,
            retrieved_chunk_ids=[c["chunk_id"] for c in evidence],
            answer_json=final_answer,
            validation_summary=validation_summary,
            model_name=gen_result.model_name,
            provider_is_fallback=generation.provider_is_fallback(),
            json_retry_used=gen_result.json_retry_used,
            latency_ms=latency_ms,
            usage=gen_result.usage,
        )
    except Exception:  # noqa: BLE001
        logger.exception("failed to persist chat trace %s", trace_id)

    # feature/decision-intelligence-layer, Phase A (additive): log the
    # router decision keyed by trace_id, in its own new table (see
    # app/db.py) -- never touches the chat_traces row above.
    if route_decision is not None:
        try:
            query_router.persist_decision(
                trace_id=trace_id,
                conversation_id=req.conversation_id,
                tenant_id=identity.tenant_id,
                query=req.query,
                decision=route_decision,
            )
        except Exception:  # noqa: BLE001
            logger.exception("failed to persist query router decision for trace %s", trace_id)

    # feature/decision-intelligence-layer, Phase C (additive): persist the
    # per-stage timings collected by `_mark_stage` above, keyed by
    # trace_id, in their own new table -- never touches the chat_traces
    # row above.
    try:
        instrumentation.record_stage_timings(
            trace_id=trace_id,
            conversation_id=req.conversation_id,
            tenant_id=identity.tenant_id,
            timings=stage_timings,
        )
    except Exception:  # noqa: BLE001
        logger.exception("failed to persist stage timings for trace %s", trace_id)

    audit.record(
        endpoint="/chat",
        identity=identity,
        filters=filters,
        query=req.query,
        evidence_chunk_ids=[c["chunk_id"] for c in evidence],
        trace_id=trace_id,
    )

    yield _sse(
        {
            "type": "final",
            "trace_id": trace_id,
            "conversation_id": req.conversation_id,
            "intent": intent,
            "query_router": route_decision.to_dict() if route_decision else None,
            "answer": final_answer,
            "evidence": [_evidence_out(c) for c in evidence],
            "citation_validation": validation_summary,
            "model_name": gen_result.model_name,
            "provider_is_fallback": generation.provider_is_fallback(),
            "json_retry_used": gen_result.json_retry_used,
            "latency_ms": latency_ms,
            "contradictions": [c.__dict__ for c in temporal_analysis.contradictions],
            "latest_document_id": temporal_analysis.latest_document_id,
            "latest_meeting_date": temporal_analysis.latest_meeting_date,
            "retrieval_passes": [p.__dict__ for p in agentic_result.passes],
        }
    )


@router.post("/chat")
async def chat(req: ChatRequest, identity: auth.Identity = Depends(auth.require_identity)) -> StreamingResponse:
    return StreamingResponse(
        _chat_stream(req, identity),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/chat/traces")
def list_traces(conversation_id: str | None = None, limit: int = 50) -> dict:
    """Basic conversation history read -- Phase 4 exit criteria requires
    `chat_traces` to be populated; this exposes it for the frontend history
    view and for manual/automated inspection."""
    conn = db.get_connection()
    if conversation_id:
        rows = conn.execute(
            "SELECT * FROM chat_traces WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
            (conversation_id, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM chat_traces ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()

    out = []
    for row in db.rows_to_list(rows):
        row["retrieved_chunk_ids"] = db.loads(row.get("retrieved_chunk_ids"), [])
        row["answer_json"] = db.loads(row.get("answer_json"), {})
        row["citation_validation"] = db.loads(row.get("citation_validation"), {})
        out.append(row)
    return {"traces": out}


# --------------------------------------------------------------------------
# Phase E (Self-Learning Copilot, additive): Feedback & Interaction Endpoints
# --------------------------------------------------------------------------


class FeedbackRequest(BaseModel):
    trace_id: str
    rating: int = Field(..., description="+1 for helpful/accurate, -1 for unhelpful/inaccurate")
    conversation_id: str | None = None
    issue_category: str | None = None
    correction_text: str | None = None


@router.post("/chat/feedback")
def submit_feedback(req: FeedbackRequest, identity: auth.Identity = Depends(auth.require_identity)) -> dict:
    from app.services import learning

    return learning.record_feedback(
        trace_id=req.trace_id,
        rating=req.rating,
        tenant_id=identity.tenant_id,
        conversation_id=req.conversation_id,
        issue_category=req.issue_category,
        correction_text=req.correction_text,
    )


class CitationClickRequest(BaseModel):
    trace_id: str
    chunk_id: str
    document_id: str
    page_number: int | None = None
    interaction_type: str = "click"


@router.post("/chat/citation-click")
def track_citation_click(req: CitationClickRequest, identity: auth.Identity = Depends(auth.require_identity)) -> dict:
    from app.services import learning

    return learning.record_citation_interaction(
        trace_id=req.trace_id,
        chunk_id=req.chunk_id,
        document_id=req.document_id,
        page_number=req.page_number,
        interaction_type=req.interaction_type,
        tenant_id=identity.tenant_id,
    )

