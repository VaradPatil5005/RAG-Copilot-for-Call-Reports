"""Post-generation citation validation (Phase 4 spec section 4).

Two checks run on every answer, before anything is returned to the
frontend -- the second one is *mandatory*, not a nice-to-have, per the
revised Phase 4 prompt:

1. Existence check: does the cited `chunk_id` actually appear in the
   evidence set that was retrieved and handed to the model? Catches
   outright-hallucinated citations.
2. Support check: does the cited chunk's content actually overlap with
   what the answer claims? Catches citations that point to a real
   `chunk_id` but don't actually support the claim -- "cited a real
   chunk_id" and "cited evidence that supports the claim" are different
   guarantees, and only the second is what a citation chip is implicitly
   promising the user.

Chosen approach (documented per the spec's "pick one, document it"
requirement): a failing citation is **stripped** from the answer and the
claim is flagged as unsupported by lowering confidence and appending an
explicit note, rather than silently regenerating. Regeneration was
considered but rejected for Phase 4: it hides the failure from the trace
log the exit criteria require, doubles generation latency/cost on every
partial miss, and offers no guarantee the retry doesn't fail the same way
-- stripping + flagging is deterministic, cheap, and auditable. (This
behavior is exactly the kind of thing a Phase 6 evaluation gate should
compare against the alternative before promoting a model.)

The support check is a cheap combination of token overlap and embedding
cosine similarity (same embedding provider as Phase 3 retrieval) -- not
sophisticated by design, per the spec, but it exists and runs on every
answer, every citation.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from app.services import embeddings

SUPPORT_THRESHOLD = 0.12  # combined overlap+similarity score; deliberately low --
# this is a coarse guardrail against clearly-unrelated citations, not a
# precision instrument. See module docstring.

_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "did", "do", "does", "what", "which",
    "who", "when", "where", "how", "of", "in", "on", "for", "to", "and", "or", "with",
    "about", "that", "this", "it", "as", "by", "be", "has", "have", "had", "not", "no",
}


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if t and t not in _STOPWORDS}


def _token_overlap(a: str, b: str) -> float:
    ta, tb = _tokenize(a), _tokenize(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


@dataclass
class CitationCheck:
    chunk_id: str
    document_id: str | None
    page: int | None
    existence_ok: bool
    support_score: float | None
    support_ok: bool
    reason: str | None = None


@dataclass
class ValidationResult:
    answer_json: dict
    checks: list[CitationCheck] = field(default_factory=list)

    @property
    def summary(self) -> dict:
        total = len(self.checks)
        existence_failed = sum(1 for c in self.checks if not c.existence_ok)
        support_failed = sum(1 for c in self.checks if c.existence_ok and not c.support_ok)
        valid = sum(1 for c in self.checks if c.existence_ok and c.support_ok)
        return {
            "total": total,
            "valid": valid,
            "stripped": existence_failed + support_failed,
            "existence_check_failed": existence_failed,
            "support_check_failed": support_failed,
        }


def validate(answer_json: dict, evidence: list[dict]) -> ValidationResult:
    evidence_by_id = {c["chunk_id"]: c for c in evidence}

    claim_text = " ".join(
        [answer_json.get("answer") or ""] + list(answer_json.get("key_findings") or [])
    ).strip()

    # Embed the claim once; embed each candidate chunk (cheap -- Phase 3's
    # cache means re-embedding an already-indexed chunk's content is a
    # cache hit, not fresh inference).
    claim_vec: list[float] | None = None
    if claim_text:
        try:
            provider = embeddings.get_default_provider()
            claim_vec = provider.embed_texts([claim_text])[0]
        except Exception:  # noqa: BLE001 -- embedding is a guardrail, never fatal
            claim_vec = None

    checks: list[CitationCheck] = []
    valid_citations = []
    any_support_failed = False
    any_existence_failed = False

    for citation in answer_json.get("citations") or []:
        chunk_id = citation.get("chunk_id")
        chunk = evidence_by_id.get(chunk_id)

        if chunk is None:
            checks.append(
                CitationCheck(
                    chunk_id=chunk_id or "(missing)",
                    document_id=citation.get("document_id"),
                    page=citation.get("page"),
                    existence_ok=False,
                    support_score=None,
                    support_ok=False,
                    reason="chunk_id not found in retrieved evidence set (hallucinated citation)",
                )
            )
            any_existence_failed = True
            continue

        chunk_text = chunk.get("raw_text") or chunk.get("snippet") or ""
        overlap = _token_overlap(claim_text, chunk_text)

        sim = 0.0
        if claim_vec is not None:
            try:
                provider = embeddings.get_default_provider()
                chunk_vec = provider.embed_texts([chunk_text])[0]
                sim = _cosine(claim_vec, chunk_vec)
            except Exception:  # noqa: BLE001
                sim = 0.0

        support_score = max(overlap, sim)
        # A citation with literally no shared vocabulary must not be
        # rescued by embedding cosine similarity alone -- general-purpose
        # sentence embeddings routinely score 0.3-0.5+ between genuinely
        # unrelated business text (an anisotropy artifact of the
        # embedding space, not evidence of relatedness). This only
        # matters once a real embedding model is reachable; the local
        # hashing fallback (ADR 0004) doesn't exhibit it the same way,
        # which is how this went unnoticed until tested against a real
        # model. Requiring at least some token overlap before `sim` can
        # count eliminates false "supported" verdicts on clearly-
        # unrelated citations without meaningfully hurting recall on
        # genuine paraphrases (which usually share at least a few terms).
        if overlap == 0.0:
            support_score = 0.0
        support_ok = support_score >= SUPPORT_THRESHOLD

        checks.append(
            CitationCheck(
                chunk_id=chunk_id,
                document_id=chunk.get("document_id"),
                page=chunk.get("page_number"),
                existence_ok=True,
                support_score=round(support_score, 4),
                support_ok=support_ok,
                reason=None if support_ok else "cited chunk does not overlap with the claim text",
            )
        )

        if support_ok:
            # Self-heal document_id/page from the actual retrieved chunk
            # rather than trusting whatever the model echoed back.
            valid_citations.append(
                {
                    "document_id": chunk.get("document_id"),
                    "page": chunk.get("page_number"),
                    "chunk_id": chunk_id,
                }
            )
        else:
            any_support_failed = True

    result_json = dict(answer_json)
    result_json["citations"] = valid_citations

    if (any_existence_failed or any_support_failed) and not result_json.get("abstained"):
        note = " (Note: one or more citations could not be verified against retrieved evidence and were removed.)"
        result_json["answer"] = (result_json.get("answer") or "") + note
        if result_json.get("confidence") == "high":
            result_json["confidence"] = "medium"

    return ValidationResult(answer_json=result_json, checks=checks)
