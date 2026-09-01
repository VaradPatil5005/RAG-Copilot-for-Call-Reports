"""PII detection and redaction (Phase 6.5).

Two distinct applications, deliberately kept separate:

1. **Logs/traces** (`chat_traces`, `access_audit_log`): the free-text
   `query` a user typed, and the free-text `answer`/`key_findings` a
   model generated, are redacted *before* being persisted -- these are
   operational telemetry a support engineer or an automated alert might
   read, and neither needs a customer's SSN or phone number sitting in
   plaintext to be useful for debugging retrieval/generation behavior.
   See `redact_for_logging()`, wired into `routers/copilot.py`'s
   `_persist_trace` and `services/audit.py`'s `record`.

2. **Ingested document content** (`chunks`): detected, never redacted.
   Redacting chunk content would defeat the entire product -- a customer
   contact's email address or a person's name is often exactly the
   evidence a call-report question needs, and this project's whole
   design principle is "answer only from evidence" (`generation.py`'s
   system prompt rule #1). Instead, `detect()`'s findings are recorded
   per-chunk (`chunks.pii_flags`, Phase 6.5) as a compliance/inventory
   signal -- which chunks contain what *category* of PII, without
   altering searchable content -- so a real deployment's data-governance
   process (Microsoft Purview, in the blueprint's target stack) has
   something to act on, without this local substitute silently deciding
   for that process what should or shouldn't be masked.

Detection here is regex-based and local -- the same honest-substitution
pattern as every other local-dev stand-in in this project. A real
deployment would use a dedicated PII detection service (Azure AI
Language's PII detection, per the blueprint) for materially better
recall (it understands context; these patterns don't) and broader
category coverage (names, addresses, dates of birth, etc., which
free-text regex cannot reliably catch without a very high false-positive
rate -- deliberately not attempted here rather than shipping a detector
that mostly produces noise).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_IP_RE = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b")
# Candidate 13-19 digit runs (with optional separators) -- Luhn-checked
# below to cut the false-positive rate on ordinary long numbers (order
# IDs, phone numbers already caught above, document IDs).
_CARD_CANDIDATE_RE = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _luhn_valid(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


@dataclass
class PIIMatch:
    category: str  # 'email' | 'phone' | 'ssn' | 'ip_address' | 'credit_card'
    start: int
    end: int
    preview: str  # first/last char only, e.g. "a***@***.com" style — never the full match


def _redacted_preview(text: str, category: str) -> str:
    if category == "email":
        local, _, domain = text.partition("@")
        return f"{local[:1]}***@***"
    return f"{text[:1]}***{text[-1:]}" if len(text) > 2 else "***"


def detect(text: str) -> list[PIIMatch]:
    if not text:
        return []
    matches: list[PIIMatch] = []
    for pattern, category in (
        (_EMAIL_RE, "email"),
        (_PHONE_RE, "phone"),
        (_SSN_RE, "ssn"),
        (_IP_RE, "ip_address"),
    ):
        for m in pattern.finditer(text):
            matches.append(PIIMatch(category, m.start(), m.end(), _redacted_preview(m.group(), category)))

    for m in _CARD_CANDIDATE_RE.finditer(text):
        digits = re.sub(r"[ -]", "", m.group())
        if 13 <= len(digits) <= 19 and _luhn_valid(digits):
            matches.append(PIIMatch("credit_card", m.start(), m.end(), _redacted_preview(m.group(), "credit_card")))

    matches.sort(key=lambda m: m.start)
    return matches


def redact_for_logging(text: str | None) -> str | None:
    """Replaces every detected span with `[REDACTED:<CATEGORY>]`. Used
    only on log/trace free-text fields -- never on chunk content (see
    module docstring)."""
    if not text:
        return text
    matches = detect(text)
    if not matches:
        return text
    out = []
    cursor = 0
    for m in matches:
        out.append(text[cursor:m.start])
        out.append(f"[REDACTED:{m.category.upper()}]")
        cursor = m.end
    out.append(text[cursor:])
    return "".join(out)


def categories_present(text: str | None) -> list[str]:
    """The compliance/inventory signal for ingested content (see module
    docstring, application 2) -- categories only, never the matched text
    itself, so this can be stored (`chunks.pii_flags`) without becoming
    its own PII-exposure surface."""
    return sorted({m.category for m in detect(text or "")})
