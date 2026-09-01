"""Metadata sniffing — many call reports carry their own header block
(Document ID / Customer / Meeting Date / Account Owner / Classification)
as either a paragraph or a two-column key-value table on page 1.

If the uploader didn't fill in the upload form's metadata fields, this
recovers them from the document's own content instead of leaving the
document un-filterable by customer/owner in the UI.

Only fills fields the uploader left blank — an explicit form value always
wins over anything sniffed from content.

`classification` is deliberately NEVER auto-filled from document content:
it's a security/ACL-relevant field, and document text is untrusted input
(see the blueprint's prompt-injection guidance) — a PDF should not be able
to self-declare its own access level. Classification only ever comes from
the upload form or a manual edit.
"""
from __future__ import annotations

import re
from typing import Any

_PATTERNS: dict[str, re.Pattern] = {
    "customer_name": re.compile(r"^\s*customer\s*:?\s*$", re.IGNORECASE),
    "account_owner": re.compile(r"^\s*(account\s*owner|owner)\s*:?\s*$", re.IGNORECASE),
    "meeting_date": re.compile(r"^\s*(meeting\s*date|date)\s*:?\s*$", re.IGNORECASE),
}

# Inline "Key: Value" form, e.g. "Customer: Contoso"
_INLINE_PATTERNS: dict[str, re.Pattern] = {
    "customer_name": re.compile(r"customer\s*:\s*(.+)", re.IGNORECASE),
    "account_owner": re.compile(r"(?:account\s*owner|owner)\s*:\s*(.+)", re.IGNORECASE),
    "meeting_date": re.compile(r"meeting\s*date\s*:\s*(.+)", re.IGNORECASE),
}

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _clean(value: str) -> str:
    return value.strip().strip(":").strip()


def _from_table_rows(rows: list[list[str | None]]) -> dict[str, str]:
    """Handles a 2-column key/value table, in either orientation:
    - one row per field: [["Customer", "Contoso"], ["Account Owner", "Priya Shah"]]
    - or a header row of labels + one data row of values (less common)."""
    found: dict[str, str] = {}
    for row in rows:
        cells = [(c or "").strip() for c in row]
        if len(cells) < 2 or not cells[0]:
            continue
        key, value = cells[0], cells[1]
        for field, pattern in _PATTERNS.items():
            if pattern.match(key) and value:
                found.setdefault(field, value)
    return found


def sniff_metadata(elements: list[dict[str, Any]]) -> dict[str, str]:
    """Scans page-1 elements (tables first, then paragraph text) for a
    document metadata header block. Returns only fields it found."""
    found: dict[str, str] = {}

    page1 = [e for e in elements if e.get("page_number") == 1]

    # 1. Tables are the most reliable signal (matches the screenshot's layout)
    for el in page1:
        if el.get("element_type") == "table" and el.get("table_json"):
            tj = el["table_json"]
            rows = [tj.get("headers", [])] + tj.get("rows", [])
            for k, v in _from_table_rows(rows).items():
                found.setdefault(k, v)

    # 2. Fall back to inline "Key: Value" text in paragraphs/headings
    for el in page1:
        text = el.get("text") or ""
        for field, pattern in _INLINE_PATTERNS.items():
            if field in found:
                continue
            m = pattern.search(text)
            if m:
                found[field] = _clean(m.group(1).splitlines()[0])

    if "meeting_date" in found:
        m = _DATE_RE.search(found["meeting_date"])
        if m:
            found["meeting_date"] = m.group(0)
        else:
            # not a recognizable date — don't guess, drop it
            found.pop("meeting_date")

    return found
