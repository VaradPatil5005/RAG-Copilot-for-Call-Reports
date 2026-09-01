"""Phase 6.5 tests: PII detection primitives, and that logs/traces are
actually redacted at the persistence boundary (not just that a redaction
function exists somewhere unused)."""
from __future__ import annotations

from app import db
from app.services import pii


def test_detects_email_phone_ssn_and_valid_credit_card():
    text = "Contact John at john.doe@example.com or 555-123-4567. SSN 123-45-6789. Card 4111 1111 1111 1111."
    categories = pii.categories_present(text)
    assert categories == ["credit_card", "email", "phone", "ssn"]


def test_luhn_check_avoids_flagging_an_ordinary_long_number():
    """A document ID or similar long digit run that fails the Luhn check
    must not be flagged as a credit card -- this is the whole reason the
    credit-card detector Luhn-validates candidates instead of just
    matching digit-count."""
    text = "Document ID CR-2026-000123456789012 was updated."
    assert "credit_card" not in pii.categories_present(text)


def test_redact_for_logging_removes_all_detected_spans():
    text = "Email me at alice@example.com about the 555-987-6543 line."
    redacted = pii.redact_for_logging(text)
    assert "alice@example.com" not in redacted
    assert "555-987-6543" not in redacted
    assert "[REDACTED:EMAIL]" in redacted
    assert "[REDACTED:PHONE]" in redacted


def test_redact_for_logging_is_a_noop_on_clean_text():
    text = "What risks were raised for Contoso?"
    assert pii.redact_for_logging(text) == text


def test_redact_for_logging_handles_none_and_empty():
    assert pii.redact_for_logging(None) is None
    assert pii.redact_for_logging("") == ""


# --------------------------------------------------------------------------
# Integration: redaction actually applied before persistence
# --------------------------------------------------------------------------


def test_chat_trace_does_not_persist_raw_pii_from_the_query(ingested):
    client = ingested["client"]
    query_with_email = "Please send the summary to alice.tester@example.com -- what risks were raised for Contoso?"
    resp = client.post("/chat", json={"query": query_with_email, "filters": {"customer": "Contoso"}})
    assert resp.status_code == 200

    conn = db.get_connection()
    row = db.row_to_dict(
        conn.execute("SELECT query FROM chat_traces ORDER BY created_at DESC LIMIT 1").fetchone()
    )
    assert row is not None
    assert "alice.tester@example.com" not in row["query"]
    assert "[REDACTED:EMAIL]" in row["query"]


def test_audit_log_does_not_persist_raw_pii_from_the_query(ingested):
    client = ingested["client"]
    query_with_phone = "Call 555-222-3333 about Contoso pricing risks"
    resp = client.post("/search", json={"query": query_with_phone, "top_k": 5})
    assert resp.status_code == 200

    conn = db.get_connection()
    row = db.row_to_dict(
        conn.execute(
            "SELECT query FROM access_audit_log WHERE endpoint = '/search' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    )
    assert row is not None
    assert "555-222-3333" not in (row["query"] or "")


def test_chunks_carry_pii_flags_without_redacting_content(ingested):
    """Ingested document content is never redacted (see pii.py's module
    docstring) -- only flagged. The sample corpus doesn't contain PII by
    design, so this just confirms the column exists and is queryable and
    that ordinary chunks are correctly left unflagged."""
    conn = db.get_connection()
    row = db.row_to_dict(conn.execute("SELECT pii_flags, raw_text FROM chunks LIMIT 1").fetchone())
    assert row is not None
    # No PII in the synthetic sample corpus -- flags should be unset, and
    # the content itself must be fully intact (not redacted).
    assert row["pii_flags"] is None
    assert row["raw_text"]
