"""Bounded agentic retrieval loops (blueprint Section 4.1).

For complex/underspecified questions, one hybrid-search pass sometimes
misses an entity or document the question needs. This module runs up to
`MAX_PASSES` retrieval passes, each triggered by a concrete, checkable
coverage gap (a detected entity from query_rewrite that never appears in
any retrieved chunk's content, or a "multi-document" question that only
surfaced evidence from one document), and each pass respects the same
hybrid retrieval + ACL filters as a single-pass search. This is orchestration
logic only — it never calls an LLM to "decide" whether to search again, per
this project's existing pattern of deliberately simple, inspectable
heuristics over model calls for control flow (see routers/copilot.py's
intent classifier and this module's docstring precedent).

Budget (per blueprint Section 4.1 / 11): max 3 total retrieval passes, no
network/tool access beyond `search_index.hybrid_search`, no write
operations. Never used to bypass ACL filters — every pass uses the same
`SearchFilters`, principals included.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services import query_rewrite, search_index

MAX_PASSES = 3
MAX_EVIDENCE = 20


@dataclass
class RetrievalPass:
    pass_number: int
    query_used: str
    reason: str
    new_chunk_ids: list[str] = field(default_factory=list)


@dataclass
class AgenticResult:
    evidence: list[dict[str, Any]]
    passes: list[RetrievalPass] = field(default_factory=list)
    trace: search_index.RetrievalTrace | None = None
    rewrite: query_rewrite.RewriteResult | None = None


def _coverage_gap(query: str, rewrite: query_rewrite.RewriteResult, evidence: list[dict[str, Any]]) -> str | None:
    """Returns a human-readable reason to run another pass, or None if
    coverage looks sufficient."""
    if not evidence:
        return None  # nothing to expand on; a second identical-strategy pass won't help
    covered_text = " ".join((c.get("content") or "") for c in evidence).lower()

    for entity in rewrite.detected_entities:
        if entity not in covered_text:
            return f"detected entity {entity!r} not present in any retrieved chunk"

    q_lower = query.lower()
    multi_doc_signal = any(
        h in q_lower for h in ("which customers", "across", "compare", "both", "all reports", "each customer")
    )
    if multi_doc_signal:
        distinct_docs = {c["document_id"] for c in evidence}
        if len(distinct_docs) < 2:
            return "query implies multiple documents but only one was retrieved"

    return None


def _subquery_for_gap(query: str, reason: str, rewrite: query_rewrite.RewriteResult) -> str:
    if reason.startswith("detected entity"):
        # Re-run with just the missing entity plus the original intent words,
        # dropping accumulated noise from prior expansions.
        return f"{query} {reason.split(chr(39))[1] if chr(39) in reason else ''}".strip()
    if "multiple documents" in reason:
        return f"{query} other customers accounts reports"
    return query


def run(
    query: str,
    top_k: int,
    filters: search_index.SearchFilters,
    max_passes: int = MAX_PASSES,
) -> AgenticResult:
    rewrite = query_rewrite.rewrite_query(query)
    passes: list[RetrievalPass] = []
    evidence, trace = search_index.retrieve_context(rewrite.rewritten_query, top_k=top_k, filters=filters)
    seen_ids = {c["chunk_id"] for c in evidence}
    passes.append(
        RetrievalPass(
            pass_number=1,
            query_used=rewrite.rewritten_query,
            reason="initial hybrid retrieval",
            new_chunk_ids=list(seen_ids),
        )
    )

    pass_number = 1
    while pass_number < max_passes and len(evidence) < MAX_EVIDENCE:
        gap = _coverage_gap(query, rewrite, evidence)
        if not gap:
            break
        pass_number += 1
        subquery = _subquery_for_gap(query, gap, rewrite)
        more_evidence, _ = search_index.retrieve_context(subquery, top_k=top_k, filters=filters)
        new_chunks = [c for c in more_evidence if c["chunk_id"] not in seen_ids]
        if not new_chunks:
            # Refined subquery found nothing new -- stop rather than loop on
            # a gap the corpus genuinely can't fill (blueprint: "stop when
            # coverage is sufficient... or the maximum ... is reached").
            passes.append(RetrievalPass(pass_number=pass_number, query_used=subquery, reason=gap, new_chunk_ids=[]))
            break
        for c in new_chunks:
            seen_ids.add(c["chunk_id"])
        evidence = evidence + new_chunks
        passes.append(
            RetrievalPass(
                pass_number=pass_number,
                query_used=subquery,
                reason=gap,
                new_chunk_ids=[c["chunk_id"] for c in new_chunks],
            )
        )

    evidence = evidence[:MAX_EVIDENCE]
    return AgenticResult(evidence=evidence, passes=passes, trace=trace, rewrite=rewrite)
