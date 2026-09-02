"""Query Router -- Phase A of the decision-intelligence-layer enhancement
(feature/decision-intelligence-layer branch).

Net-new module. Classifies an incoming Copilot query into one of five
shapes -- lookup, comparison, trend, multi_hop, graph_relationship -- and
attaches that classification as *metadata* on the request trace.

This is deliberately a different taxonomy from `routers/copilot.py`'s
existing `classify_intent()` (answerable_single_pass /
likely_needs_multiple_documents / likely_unanswerable /
cross_document_graph), which already exists, is already wired into top_k
sizing and GraphRAG routing, and is explicitly NOT touched, renamed, or
reimplemented here (see the master prompt's hard constraints). The two
classifiers answer different questions:

  - `classify_intent()`      -> "how much evidence, and does this need
                                 the graph store at all?"
  - `classify_query()` (here) -> "what *shape* of reasoning does this
                                 query need?" (a single fact vs. a
                                 side-by-side comparison vs. a
                                 time-series trend vs. a chained/
                                 multi-hop question vs. an explicit
                                 entity-relationship question)

Design, per the master prompt's constraint #6 (fallback-provider pattern
must match existing AI-dependent components): heuristics run first and
are cheap/deterministic; an LLM classifier is only consulted when the
heuristics are genuinely ambiguous, and only if a real hosted/local LLM
is actually reachable (`generation.provider_is_fallback()` is False) --
mirroring `services/generation.py`'s own
try-real-provider-then-deterministic-fallback shape. When no LLM is
reachable, classification stays 100% heuristic with a lower confidence
level rather than silently degrading in some other way.

Consumption is additive-only: `routers/copilot.py` calls `classify_query`
and `persist_decision` from inside try/except blocks that can never raise
into the existing chat flow, and only *adds* evidence (never removes or
reorders it) when the router's category suggests a path the existing
intent classifier didn't already trigger. See that file's
`feature/decision-intelligence-layer` comments for the integration point.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from app import db

logger = logging.getLogger("copilot.routing.query_router")

Category = Literal["lookup", "comparison", "trend", "multi_hop", "graph_relationship"]
Method = Literal["heuristic", "llm_fallback", "heuristic_default"]
Confidence = Literal["high", "medium", "low"]

CATEGORIES: tuple[Category, ...] = (
    "lookup",
    "comparison",
    "trend",
    "multi_hop",
    "graph_relationship",
)

# Which existing retrieval path(s) each category suggests preferring.
# Purely advisory metadata -- see module docstring. Every path named here
# already exists (agentic_retrieval's hybrid search / multi-pass, the
# GraphRAG store, temporal.analyze); nothing new is introduced by this
# mapping.
_SUGGESTED_PATHS: dict[Category, tuple[str, ...]] = {
    "lookup": ("hybrid_search",),
    "comparison": ("hybrid_search", "agentic_multi_pass"),
    "trend": ("hybrid_search", "temporal_analysis"),
    "multi_hop": ("agentic_multi_pass", "hybrid_search"),
    "graph_relationship": ("graph_store", "hybrid_search"),
}


@dataclass
class QueryRouteDecision:
    category: Category
    method: Method
    confidence: Confidence
    signals: dict[str, Any] = field(default_factory=dict)
    suggested_paths: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "method": self.method,
            "confidence": self.confidence,
            "signals": self.signals,
            "suggested_paths": list(self.suggested_paths),
        }


# --- Heuristics --------------------------------------------------------------

_COMPARISON_TERMS = (
    "vs", "vs.", "versus", "compare", "compared to", "comparison",
    "difference between", "which is better", "better than", "worse than",
    "more than", "less than", "side by side", "relative to",
)
_TREND_TERMS = (
    "trend", "trending", "over time", "over the last", "over the past",
    "increase", "increased", "increasing", "decrease", "decreased",
    "decreasing", "change since", "changed since", "quarter over quarter",
    "month over month", "growth", "declining", "decline", "history of",
    "trajectory", "year over year",
)
_GRAPH_TERMS = (
    "connected to", "connect this account", "related to", "relationship between",
    "same competitor", "shared competitor", "mention the same", "mentions the same",
    "linked to", "network of", "in common with", "connections between",
    "who else mentions", "which accounts share",
)
_LOOKUP_TERMS = (
    "what is", "what was", "when did", "who is", "who was", "show me",
    "what does", "where is", "how much is", "what are",
)
_MULTIHOP_CONJUNCTIONS = (
    " and then ", " after that ", " which then ", " who then ",
    " and also ", " once that", " and finally ",
)
_SENTENCE_STARTERS = {
    "what", "which", "who", "when", "where", "how", "did", "was",
    "were", "is", "are", "has", "have", "had", "does", "do", "the",
}


def _proper_noun_count(query: str) -> int:
    """Same lightweight entity-count primitive style already used by
    `services/generation.py`'s `ExtractiveFallbackProvider` (capitalized
    word, not a sentence-starter) -- reused for consistency, not
    imported, since that class is a generation internal, not a shared
    util."""
    words = [
        w for w in re.findall(r"\b[A-Z][a-zA-Z]{2,}\b", query)
        if w.lower() not in _SENTENCE_STARTERS
    ]
    return len(set(words))


def _score_heuristics(query: str) -> tuple[dict[Category, int], dict[str, list[str]]]:
    q = f" {query.lower().strip()} "
    matched: dict[str, list[str]] = {c: [] for c in CATEGORIES}

    for term in _COMPARISON_TERMS:
        if term in q:
            matched["comparison"].append(term)
    for term in _TREND_TERMS:
        if term in q:
            matched["trend"].append(term)
    for term in _GRAPH_TERMS:
        if term in q:
            matched["graph_relationship"].append(term)
    for term in _LOOKUP_TERMS:
        if term in q:
            matched["lookup"].append(term)

    entity_count = _proper_noun_count(query)
    has_conjunction = any(term in q for term in _MULTIHOP_CONJUNCTIONS)
    multi_question_marks = query.count("?") >= 2
    if (entity_count >= 2 and has_conjunction) or multi_question_marks:
        matched["multi_hop"].append(f"entities={entity_count}")
        if has_conjunction:
            matched["multi_hop"].append("chained_conjunction")
        if multi_question_marks:
            matched["multi_hop"].append("multiple_question_marks")

    scores: dict[Category, int] = {c: len(matched[c]) for c in CATEGORIES}
    return scores, matched


def _pick_from_scores(scores: dict[Category, int]) -> tuple[Category | None, bool]:
    """Returns (best_category_or_None, ambiguous). Ambiguous when nothing
    scored, or when the top score is tied across 2+ categories."""
    ranked = sorted(CATEGORIES, key=lambda c: scores[c], reverse=True)
    top_score = scores[ranked[0]]
    if top_score == 0:
        return None, True
    tied = [c for c in CATEGORIES if scores[c] == top_score]
    if len(tied) > 1:
        return None, True
    return ranked[0], False


# --- LLM fallback (reachability-gated, matches services/generation.py) ------

_ROUTER_SYSTEM_PROMPT = """You are a query router for a call-report RAG system. \
Classify the user's question into exactly one category:
- lookup: a single, direct factual question
- comparison: asks to compare/contrast two or more things
- trend: asks about change over time / trajectory / growth or decline
- multi_hop: requires chaining multiple facts or steps together
- graph_relationship: asks about an explicit relationship/connection between entities \
(e.g. shared competitors, linked accounts)

Respond with ONLY a JSON object, no other text: {"category": "<one of the five \
categories above>", "confidence": "high" | "medium" | "low"}"""


def _try_llm_classify(query: str, provider) -> tuple[Category, Confidence] | None:
    try:
        raw = provider.generate(_ROUTER_SYSTEM_PROMPT, query, stream=False, max_tokens=60)
        if not isinstance(raw, str):
            raw = "".join(raw)  # type: ignore[arg-type]
        text = raw.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        data = json.loads(text)
        category = data.get("category")
        confidence = data.get("confidence", "medium")
        if category not in CATEGORIES:
            return None
        if confidence not in ("high", "medium", "low"):
            confidence = "medium"
        return category, confidence  # type: ignore[return-value]
    except Exception as exc:  # noqa: BLE001
        logger.warning("query router LLM fallback failed to produce a usable classification: %s", exc)
        return None


def classify_query(query: str, provider=None) -> QueryRouteDecision:
    """Classify `query`. Heuristics run first; an LLM is only consulted
    when heuristics are ambiguous AND a real hosted/local LLM is actually
    reachable (never the deterministic extractive fallback -- that
    provider's `generate()` expects the evidence-based generation prompt
    shape, not a classification prompt, so it is never a meaningful
    classifier and is skipped in favor of staying heuristic-only).

    `provider` is accepted explicitly (mirrors
    `generation.generate_structured_answer`'s own `provider=` parameter)
    so tests can inject a fake provider without touching global state.
    """
    scores, matched = _score_heuristics(query)
    best, ambiguous = _pick_from_scores(scores)

    if not ambiguous and best is not None:
        confidence: Confidence = "high" if scores[best] >= 2 else "medium"
        return QueryRouteDecision(
            category=best,
            method="heuristic",
            confidence=confidence,
            signals={"scores": scores, "matched_terms": matched},
            suggested_paths=_SUGGESTED_PATHS[best],
        )

    # Ambiguous -- try the LLM fallback, but only if a real model is
    # actually reachable (reachability-gated, per constraint #6).
    from app.services import generation  # local import: avoid import-time coupling

    llm_result = None
    if not generation.provider_is_fallback():
        active_provider = provider or generation.get_default_provider()
        llm_result = _try_llm_classify(query, active_provider)

    if llm_result is not None:
        category, confidence = llm_result
        return QueryRouteDecision(
            category=category,
            method="llm_fallback",
            confidence=confidence,
            signals={"scores": scores, "matched_terms": matched, "llm_reachable": True},
            suggested_paths=_SUGGESTED_PATHS[category],
        )

    # Deterministic default: no clear heuristic signal and no usable LLM
    # classification -- default to "lookup" (the cheapest, safest
    # retrieval path) rather than guessing at a more expensive one.
    return QueryRouteDecision(
        category="lookup",
        method="heuristic_default",
        confidence="low",
        signals={"scores": scores, "matched_terms": matched, "llm_reachable": not generation.provider_is_fallback()},
        suggested_paths=_SUGGESTED_PATHS["lookup"],
    )


# --- Persistence (new, additive table -- see app/db.py) ---------------------


def persist_decision(
    *,
    trace_id: str | None,
    conversation_id: str | None,
    tenant_id: str | None,
    query: str,
    decision: QueryRouteDecision,
) -> None:
    """Logs the routing decision to a new `query_router_decisions` table,
    keyed by `trace_id` so it joins cleanly against the existing
    `chat_traces` table for Phase C observability -- without adding any
    column to `chat_traces` itself (see db.py's Phase A migration note)."""
    now = datetime.now(timezone.utc).isoformat()
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO query_router_decisions (
                trace_id, conversation_id, tenant_id, query, category,
                method, confidence, signals_json, suggested_paths, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                conversation_id,
                tenant_id,
                query,
                decision.category,
                decision.method,
                decision.confidence,
                db.dumps(decision.signals),
                db.dumps(list(decision.suggested_paths)),
                now,
            ),
        )
