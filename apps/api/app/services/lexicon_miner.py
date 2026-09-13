"""Domain lexicon and acronym discovery miner.

Discovers enterprise jargon, acronyms, and company aliases from document content
and query interaction patterns. Mined terms are scoped by tenant_id and surfaced
for dynamic query expansion.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from app import db

logger = logging.getLogger("copilot.lexicon_miner")

# Patterns for discovering acronyms in document text:
# e.g., "Battery Electric Vehicle (BEV)" or "BEV (Battery Electric Vehicle)"
_ACRONYM_PATTERNS = [
    # Full Name (ACRONYM) where acronym is 2-6 uppercase letters
    re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Za-z][a-z]+){1,5})\s*\(([A-Z]{2,6})\)"),
    # ACRONYM (Full Name)
    re.compile(r"\b([A-Z]{2,6})\s*\(([A-Z][a-z]+(?:\s+[A-Za-z][a-z]+){1,5})\)"),
    # ACRONYM - Full Name / ACRONYM: Full Name
    re.compile(r"\b([A-Z]{2,6})\s*[:\-–]\s*([A-Z][a-z]+(?:\s+[A-Za-z][a-z]+){1,5})\b"),
]

# Common generic acronyms to ignore
_STOP_ACRONYMS = {
    "THE", "AND", "FOR", "NOT", "YES", "PDF", "DOC", "HTTP", "HTTPS", "URL",
    "API", "SQL", "USA", "USD", "EUR", "GBP", "CEO", "CFO", "CTO", "COO", "VP",
    "EST", "PST", "UTC", "GMT", "AM", "PM", "JAN", "FEB", "MAR", "APR", "MAY",
    "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "Q1", "Q2", "Q3", "Q4",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def mine_acronyms_from_text(text: str) -> list[tuple[str, str]]:
    """Finds (acronym, expansion) pairs from text."""
    if not text:
        return []
    found: set[tuple[str, str]] = set()

    for pattern in _ACRONYM_PATTERNS:
        for match in pattern.finditer(text):
            g1, g2 = match.group(1).strip(), match.group(2).strip()
            # Determine which group is the acronym (all uppercase, 2-6 chars)
            if g2.isupper() and 2 <= len(g2) <= 6:
                acronym, expansion = g2, g1
            elif g1.isupper() and 2 <= len(g1) <= 6:
                acronym, expansion = g1, g2
            else:
                continue

            if acronym in _STOP_ACRONYMS:
                continue
            if len(expansion.split()) < 2 and len(expansion) < 4:
                continue

            found.add((acronym.lower(), expansion.lower()))

    return list(found)


def mine_and_persist_from_document(
    document_id: str,
    text_corpus: str,
    tenant_id: str,
    source: str = "ingestion_extraction",
) -> int:
    """Extracts acronyms/aliases from a document's full extracted text and
    upserts them into learned_lexicon."""
    candidates = mine_acronyms_from_text(text_corpus)
    if not candidates:
        return 0

    now = _now()
    count = 0
    with db.tx() as conn:
        for acronym, expansion in candidates:
            conn.execute(
                """
                INSERT INTO learned_lexicon (
                    tenant_id, term, expansion, category, source,
                    confidence, frequency, status, created_at, updated_at
                ) VALUES (?, ?, ?, 'acronym', ?, 0.85, 1, 'active', ?, ?)
                ON CONFLICT(tenant_id, term, expansion) DO UPDATE SET
                    frequency = frequency + 1,
                    confidence = min(1.0, confidence + 0.05),
                    updated_at = excluded.updated_at
                """,
                (tenant_id, acronym, expansion, source, now, now),
            )
            count += 1

    logger.info("Mined %d lexicon terms for document %s (tenant=%s)", count, document_id, tenant_id)
    return count


def get_active_lexicon(tenant_id: str) -> dict[str, Any]:
    """Returns active acronyms, company aliases, and domain synonyms for a tenant."""
    conn = db.get_connection()
    rows = conn.execute(
        """
        SELECT term, expansion, category, confidence, frequency
        FROM learned_lexicon
        WHERE tenant_id = ? AND status = 'active'
        ORDER BY frequency DESC, confidence DESC
        """,
        (tenant_id,),
    ).fetchall()

    acronyms: dict[str, str] = {}
    aliases: dict[str, list[str]] = {}
    synonyms: dict[str, list[str]] = {}

    for r in rows:
        cat = r["category"]
        term = r["term"].lower()
        expansion = r["expansion"].lower()
        if cat == "acronym":
            acronyms[term] = expansion
        elif cat == "company_alias":
            aliases.setdefault(term, []).append(expansion)
        elif cat == "domain_synonym":
            synonyms.setdefault(term, []).append(expansion)

    return {
        "acronyms": acronyms,
        "company_aliases": aliases,
        "domain_synonyms": synonyms,
    }


def list_lexicon_items(tenant_id: str, status: str | None = None) -> list[dict[str, Any]]:
    """Returns all lexicon entries for review/admin UI."""
    conn = db.get_connection()
    if status:
        rows = conn.execute(
            "SELECT * FROM learned_lexicon WHERE tenant_id = ? AND status = ? ORDER BY frequency DESC, created_at DESC",
            (tenant_id, status),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM learned_lexicon WHERE tenant_id = ? ORDER BY frequency DESC, created_at DESC",
            (tenant_id,),
        ).fetchall()
    return db.rows_to_list(rows)


def update_lexicon_status(term_id: int, new_status: str, tenant_id: str) -> bool:
    """Updates a lexicon item's status ('active', 'pending_review', 'rejected')."""
    if new_status not in ("active", "pending_review", "rejected"):
        raise ValueError(f"Invalid status: {new_status}")
    now = _now()
    with db.tx() as conn:
        cursor = conn.execute(
            "UPDATE learned_lexicon SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
            (new_status, now, term_id, tenant_id),
        )
        return cursor.rowcount > 0
