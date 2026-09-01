"""Temporal and contradiction handling (blueprint Section 2.2 / priority
improvement "Temporal reasoning").

Given a set of retrieved evidence chunks, flags cases where two chunks from
*different* documents or *different* meeting dates make opposite status
claims about what looks like the same topic (same section path / same
customer). The rule is deliberately conservative — it looks for an explicit
negation-flip keyword pair, not general semantic disagreement, to avoid
false-positive "contradictions" that would undermine trust in real ones.

Per the blueprint: "do not silently choose one unless the question
explicitly asks for 'latest' and the evidence supports a clear ordering."
`resolve_recency` implements that ordering; `find_contradictions` implements
the "present both, note the conflict" behavior for everything else.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Each pair is (state_a, state_b) — if one chunk contains state_a's keywords
# and another contains state_b's for what looks like the same topic, that's
# a candidate contradiction worth surfacing rather than silently picking one.
_FLIP_PAIRS: list[tuple[set[str], set[str]]] = [
    ({"approved", "accepted"}, {"not approved", "declined", "rejected", "did not approve"}),
    ({"open", "outstanding", "pending"}, {"completed", "closed", "resolved", "done"}),
    ({"increased", "increase", "growing"}, {"decreased", "decrease", "declining", "shrinking"}),
    ({"on track", "on schedule"}, {"delayed", "at risk", "behind schedule"}),
    ({"confirmed"}, {"cancelled", "canceled", "postponed"}),
]


@dataclass
class Contradiction:
    topic_hint: str
    document_a: str
    date_a: str | None
    statement_a: str
    document_b: str
    date_b: str | None
    statement_b: str


@dataclass
class TemporalAnalysis:
    contradictions: list[Contradiction] = field(default_factory=list)
    latest_document_id: str | None = None
    latest_meeting_date: str | None = None
    ordering_is_clear: bool = False


def _topic_key(chunk: dict[str, Any]) -> str:
    path = chunk.get("section_path") or []
    return " > ".join(path[-2:]) if path else (chunk.get("customer_name") or "")


def _contains_any(text: str, terms: set[str]) -> str | None:
    text_lower = text.lower()
    for t in terms:
        if t in text_lower:
            return t
    return None


def find_contradictions(evidence: list[dict[str, Any]]) -> list[Contradiction]:
    found: list[Contradiction] = []
    seen_pairs: set[tuple[str, str]] = set()
    for i, a in enumerate(evidence):
        for b in evidence[i + 1 :]:
            if a["document_id"] == b["document_id"]:
                continue  # same-report internal variance isn't a cross-report contradiction
            if _topic_key(a) != _topic_key(b) or not _topic_key(a):
                continue
            text_a = a.get("raw_text") or a.get("content") or ""
            text_b = b.get("raw_text") or b.get("content") or ""
            for side_a_terms, side_b_terms in _FLIP_PAIRS:
                hit_a = _contains_any(text_a, side_a_terms) or _contains_any(text_a, side_b_terms)
                hit_b = _contains_any(text_b, side_a_terms) or _contains_any(text_b, side_b_terms)
                a_in_side1 = _contains_any(text_a, side_a_terms)
                b_in_side2 = _contains_any(text_b, side_b_terms)
                a_in_side2 = _contains_any(text_a, side_b_terms)
                b_in_side1 = _contains_any(text_b, side_a_terms)
                flips = (a_in_side1 and b_in_side2) or (a_in_side2 and b_in_side1)
                if not flips:
                    continue
                key = tuple(sorted([a["chunk_id"], b["chunk_id"]]))
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                found.append(
                    Contradiction(
                        topic_hint=_topic_key(a),
                        document_a=a["document_id"],
                        date_a=a.get("meeting_date"),
                        statement_a=text_a[:280],
                        document_b=b["document_id"],
                        date_b=b.get("meeting_date"),
                        statement_b=text_b[:280],
                    )
                )
    return found


def resolve_recency(evidence: list[dict[str, Any]]) -> tuple[str | None, str | None, bool]:
    """Returns (latest_document_id, latest_meeting_date, ordering_is_clear).
    ordering_is_clear is False when dates are missing or tied — the blueprint
    is explicit that recency should only be used to pick a "current" answer
    when "the evidence supports a clear ordering.\""""
    dated = [(c.get("meeting_date"), c["document_id"]) for c in evidence if c.get("meeting_date")]
    if not dated:
        return None, None, False
    dated.sort(key=lambda t: t[0], reverse=True)
    latest_date, latest_doc = dated[0]
    is_clear = len(dated) == 1 or dated[0][0] != dated[1][0]
    return latest_doc, latest_date, is_clear


def analyze(evidence: list[dict[str, Any]]) -> TemporalAnalysis:
    contradictions = find_contradictions(evidence)
    latest_doc, latest_date, is_clear = resolve_recency(evidence)
    return TemporalAnalysis(
        contradictions=contradictions,
        latest_document_id=latest_doc,
        latest_meeting_date=latest_date,
        ordering_is_clear=is_clear,
    )
