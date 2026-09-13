"""Query understanding, rewriting, and entity aliasing (Phase 5).

Implements the blueprint's Section 1.1 / the improvement doc's priority #2:
before retrieval, detect whether a query is identifier-heavy or semantic,
expand company-name aliases and domain acronyms, and normalize relative
date language ("latest", "current", "previously"). This is a lightweight,
rule-based rewriter — not a model call — matching the project's existing
posture of "deliberately simple heuristics, not a model call" used by the
Phase 4 intent classifier (see routers/copilot.py).

The rewritten query is used for retrieval only; the original query is
always what's shown to the user and passed to generation, so citations and
displayed text never depend on the rewrite.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Alias / acronym tables
# --------------------------------------------------------------------------
# Seeded from the two source blueprint PDFs' own examples (Tata Motors/TML,
# BMW Group/BMW, fleet operations/delivery intelligence, etc.) plus the
# synthetic Contoso/Globex sample corpus this project ships with. This is a
# static table, not a learned model — extend it as real customer/domain
# vocabulary is observed, per the blueprint's "detect content attempting to
# override system behavior" caution: never let aliasing pull terms from
# untrusted document content, only from this maintained table.

COMPANY_ALIASES: dict[str, list[str]] = {
    "contoso": ["contoso ltd", "contoso limited"],
    "globex": ["globex corporation", "globex corp"],
    "tata motors": ["tml", "tata"],
    "bmw group": ["bmw"],
    "spacex": ["space exploration technologies"],
}

DOMAIN_SYNONYMS: dict[str, list[str]] = {
    "fleet operations": ["delivery intelligence"],
    "electrification": ["emobility", "e-mobility"],
    "quality": ["defects", "8d"],
    "pricing": ["price proposal", "quote"],
    "risk": ["risks", "concern", "concerns"],
    "action": ["actions", "next step", "next steps", "follow-up", "followup"],
    "pipeline": ["opportunity value", "deal value"],
}

ACRONYMS: dict[str, str] = {
    "bev": "battery electric vehicle",
    "phev": "plug-in hybrid electric vehicle",
    "ev": "electric vehicle",
    "sku": "stock keeping unit",
    "8d": "eight discipline problem solving",
    "sla": "service level agreement",
    "acl": "access control list",
    "rrf": "reciprocal rank fusion",
    "mrr": "mean reciprocal rank",
}

_RECENCY_TERMS = {"latest", "current", "currently", "now", "still", "up to date", "most recent"}
_HISTORICAL_TERMS = {"previously", "before", "originally", "used to", "earlier", "prior"}

# Identifier-heavy signals: report/document IDs, dates, currency, percentages,
# capitalized multi-word proper nouns (company/person names).
_ID_PATTERNS = [
    re.compile(r"\bCR-\d{4}-\d+\b", re.IGNORECASE),
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
    re.compile(r"[$€£]\s?[\d,.]+"),
    re.compile(r"\b\d+(\.\d+)?%\b"),
    re.compile(r"\b[A-Z][a-zA-Z]*\s?\d+\b"),
]
_SEMANTIC_HINTS = {
    "risk", "risks", "objective", "summary", "trend", "trends", "why", "how",
    "overview", "sentiment", "opportunity", "opportunities", "concern",
}

_TOKEN_RE = re.compile(r"[A-Za-z0-9%$€£.\-]+")


@dataclass
class RewriteResult:
    original_query: str
    rewritten_query: str
    intent_mode: str  # "identifier_heavy" | "semantic"
    expansions: list[str] = field(default_factory=list)
    recency_hint: str | None = None  # "latest" | "previous" | None
    detected_entities: list[str] = field(default_factory=list)


def classify_intent_mode(query: str) -> str:
    """identifier-heavy -> favor BM25/exact filters; semantic -> favor dense
    retrieval. See blueprint Section 1.1."""
    if any(p.search(query) for p in _ID_PATTERNS):
        return "identifier_heavy"
    q_lower = query.lower()
    if any(h in q_lower for h in _SEMANTIC_HINTS):
        return "semantic"
    # Short, proper-noun-only queries (e.g. "Contoso Q2") read as identifier
    # lookups; longer natural-language questions read as semantic.
    return "identifier_heavy" if len(query.split()) <= 4 else "semantic"


def _detect_recency(query: str) -> str | None:
    q_lower = query.lower()
    if any(t in q_lower for t in _RECENCY_TERMS):
        return "latest"
    if any(t in q_lower for t in _HISTORICAL_TERMS):
        return "previous"
    return None


def _detect_entities(query: str, extra_aliases: dict[str, list[str]] | None = None) -> list[str]:
    found = []
    q_lower = query.lower()
    combined_aliases = dict(COMPANY_ALIASES)
    if extra_aliases:
        for k, v in extra_aliases.items():
            combined_aliases.setdefault(k, []).extend(v)

    for canonical, aliases in combined_aliases.items():
        if canonical in q_lower or any(a in q_lower for a in aliases):
            found.append(canonical)
    return found


def rewrite_query(query: str, tenant_id: str = "tenant-a") -> RewriteResult:
    """Expands synonyms/aliases/acronyms and normalizes recency language.
    Combines static seed tables with self-discovered terms from learned_lexicon.
    Returns both the rewritten (retrieval-only) query and metadata used to
    steer downstream retrieval weighting and answer-time recency handling.
    """
    expansions: list[str] = []
    q_lower = query.lower()

    # Load active learned lexicon for this tenant
    from app.services import lexicon_miner

    try:
        learned = lexicon_miner.get_active_lexicon(tenant_id)
    except Exception:
        learned = {"acronyms": {}, "company_aliases": {}, "domain_synonyms": {}}

    combined_aliases = dict(COMPANY_ALIASES)
    for k, v in learned.get("company_aliases", {}).items():
        combined_aliases.setdefault(k, []).extend(v)

    combined_synonyms = dict(DOMAIN_SYNONYMS)
    for k, v in learned.get("domain_synonyms", {}).items():
        combined_synonyms.setdefault(k, []).extend(v)

    combined_acronyms = {**ACRONYMS, **learned.get("acronyms", {})}

    additions: list[str] = []
    for canonical, aliases in combined_aliases.items():
        hit = canonical if canonical in q_lower else next((a for a in aliases if a in q_lower), None)
        if hit:
            for alt in [canonical, *aliases]:
                if alt != hit and alt.lower() not in q_lower:
                    additions.append(alt)
                    expansions.append(f"{hit} -> {alt}")

    for canonical, synonyms in combined_synonyms.items():
        hit = canonical if canonical in q_lower else next((s for s in synonyms if s in q_lower), None)
        if hit:
            for alt in [canonical, *synonyms]:
                if alt != hit and alt.lower() not in q_lower:
                    additions.append(alt)
                    expansions.append(f"{hit} -> {alt}")

    for token in _TOKEN_RE.findall(q_lower):
        expansion = combined_acronyms.get(token)
        if expansion and expansion not in q_lower:
            additions.append(expansion)
            expansions.append(f"{token} -> {expansion}")

    rewritten = query
    if additions:
        # Additive, not destructive: original terms stay first (so exact-
        # match/BM25 still favors them), expansions appended for recall.
        rewritten = f"{query} {' '.join(dict.fromkeys(additions))}"

    return RewriteResult(
        original_query=query,
        rewritten_query=rewritten,
        intent_mode=classify_intent_mode(query),
        expansions=expansions,
        recency_hint=_detect_recency(query),
        detected_entities=_detect_entities(query, learned.get("company_aliases")),
    )

