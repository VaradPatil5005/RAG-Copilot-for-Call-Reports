"""Metadata sniffing — automatically recovers Customer Name, Account Owner,
and Meeting Date from document content when not supplied in the upload form.

Scans:
1. Recommended metadata tags / annotation lines (e.g. "Recommended metadata: organization=... | owner=...").
2. Page-1 structured key-value tables (Field/Value rows for Customer, Stakeholders, Report Owner, Date).
3. Page-1 primary document headings (e.g. "[Organization Name] — [Meeting Type]").
4. Inline key-value paragraphs ("Customer: ...", "Report Owner: ...", "Meeting Date: ...").

`classification` is deliberately NEVER auto-filled from document content:
it's a security/ACL-relevant field and only comes from the upload form or manual edit.
"""
from __future__ import annotations

import re
from typing import Any

_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")


def _clean_owner_name(raw: str) -> str:
    """Extract clean person name from string that may contain job titles,
    e.g. 'Rohit Mehra — Financial Services Account Director' -> 'Rohit Mehra'."""
    if not raw:
        return ""
    # Strip role suffix separated by em-dash, en-dash, hyphen, replacement char, or pipe
    parts = re.split(r"\s*[—–\-\ufffd|]\s*", raw)
    if len(parts) > 1 and len(parts[0].split()) <= 4:
        return parts[0].strip()
    return raw.strip()


def _clean_customer_name(raw: str) -> str:
    """Clean company or stakeholder list, e.g. 'Dr. R. Iyer (Principal Investigator); Priya Das...'
    -> 'Dr. R. Iyer'."""
    if not raw:
        return ""
    if ";" in raw:
        first = raw.split(";")[0].strip()
        cleaned = re.sub(r"\(.*?\)", "", first).strip()
        return cleaned or first
    return raw.strip()


def _from_table_rows(rows: list[list[str | None]]) -> dict[str, str]:
    """Extracts metadata fields from 2-column key/value tables."""
    found: dict[str, str] = {}
    for row in rows:
        cells = [(c or "").strip() for c in row]
        if len(cells) < 2 or not cells[0]:
            continue
        key, val = cells[0].lower(), cells[1].strip()
        if not val:
            continue

        # Account / Report Owner (explicitly exclude ID fields like 'report id')
        if not found.get("account_owner") and ("id" not in key) and re.search(
            r"\b(report\s*owner|account\s*owner|owner|author|lead|prepared\s*by|manager|csm|sales\s*rep)\b",
            key,
        ):
            found["account_owner"] = _clean_owner_name(val)

        # Meeting Date
        if not found.get("meeting_date") and any(
            w in key for w in ["meeting date", "call date", "visit date", "date"]
        ):
            d_match = _DATE_RE.search(val)
            if d_match:
                found["meeting_date"] = d_match.group(0)

        # Customer / Organization / Stakeholders
        if not found.get("customer_name") and any(
            w in key for w in ["customer", "client", "organization", "company", "account", "stakeholder"]
        ):
            found["customer_name"] = _clean_customer_name(val)

    return found


def sniff_metadata(elements: list[dict[str, Any]]) -> dict[str, str]:
    """Extracts customer_name, account_owner, and meeting_date from document elements."""
    found: dict[str, str] = {}

    full_text = "\n".join(e.get("text") or "" for e in elements)

    # 1. Check for explicit "Recommended metadata:" block (often near end or annotations)
    rec_meta_match = re.search(r"Recommended metadata:\s*([^\n]+)", full_text, re.IGNORECASE)
    if rec_meta_match:
        meta_line = rec_meta_match.group(1)
        m_org = re.search(r"\b(?:organization|customer|company)\s*=\s*([^|\n]+)", meta_line, re.IGNORECASE)
        m_owner = re.search(r"\b(?:owner|account_owner|author)\s*=\s*([^|\n]+)", meta_line, re.IGNORECASE)
        m_date = re.search(r"\b(?:meeting_date|date)\s*=\s*([^|\n]+)", meta_line, re.IGNORECASE)

        if m_org and m_org.group(1).strip():
            found["customer_name"] = m_org.group(1).strip()
        if m_owner and m_owner.group(1).strip():
            found["account_owner"] = _clean_owner_name(m_owner.group(1).strip())
        if m_date and m_date.group(1).strip():
            d_match = _DATE_RE.search(m_date.group(1))
            if d_match:
                found["meeting_date"] = d_match.group(0)

    page1 = [e for e in elements if e.get("page_number") == 1]

    # 2. Check Page 1 Tables (Field / Value rows)
    for el in page1:
        if el.get("element_type") == "table" and el.get("table_json"):
            tj = el["table_json"]
            rows = [tj.get("headers", [])] + tj.get("rows", [])
            for k, v in _from_table_rows(rows).items():
                if not found.get(k):
                    found[k] = v

    # 3. Check Page 1 Headings for "[Organization Name] — [Call Purpose / Meeting Title]"
    # e.g. "Northstar Bank — Enterprise fraud-platform discovery call"
    # or "Apex Precision Components — Supplier quality escalation..."
    for el in page1:
        if el.get("element_type") == "heading":
            text = (el.get("text") or "").strip()
            if "—" in text or " - " in text or " – " in text:
                parts = re.split(r"\s*[—–-]\s*", text)
                if len(parts) >= 2:
                    first = parts[0].strip()
                    second = parts[1].strip()
                    if first.lower() == "call report":
                        # e.g. "Call Report — Contoso Follow-up — 2026-05-31"
                        if not found.get("customer_name") or len(found.get("customer_name", "")) > 30:
                            candidate = second.split()[0].strip()
                            if candidate:
                                found["customer_name"] = candidate
                    elif (
                        not first.startswith("Synthetic")
                        and not first.startswith("Figure")
                        and not first.startswith("Table")
                        and not first.startswith("Page")
                        and not first.startswith("CR-")
                    ):
                        # Use the organization name if customer_name is missing or is just an individual person
                        if not found.get("customer_name") or found.get("customer_name", "").startswith("Dr."):
                            found["customer_name"] = first
                        break

    # 4. Fall back to inline "Key: Value" patterns in paragraphs
    inline_patterns = {
        "customer_name": re.compile(r"(?:customer|organization|client|company)\s*:\s*(.+)", re.IGNORECASE),
        "account_owner": re.compile(r"(?:account\s*owner|report\s*owner|owner|author|prepared\s*by)\s*:\s*(.+)", re.IGNORECASE),
        "meeting_date": re.compile(r"(?:meeting\s*date|call\s*date|visit\s*date|date)\s*:\s*(.+)", re.IGNORECASE),
    }
    for el in page1:
        text = el.get("text") or ""
        for field, pat in inline_patterns.items():
            if field not in found:
                m = pat.search(text)
                if m:
                    val = m.group(1).splitlines()[0].strip().strip(":").strip()
                    if field == "account_owner":
                        found[field] = _clean_owner_name(val)
                    elif field == "meeting_date":
                        d_m = _DATE_RE.search(val)
                        if d_m:
                            found[field] = d_m.group(0)
                    else:
                        found[field] = _clean_customer_name(val)

    # 5. Clean / Validate meeting_date format
    if "meeting_date" in found:
        m = _DATE_RE.search(found["meeting_date"])
        if m:
            found["meeting_date"] = m.group(0)
        else:
            found.pop("meeting_date", None)

    return found
