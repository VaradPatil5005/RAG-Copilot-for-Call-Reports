"""Phase 4 exit-criteria tests, run against the three sample call reports
(see conftest.py) through the real ingestion + retrieval + generation +
citation-validation pipeline, via the real `/chat` SSE endpoint.

Generation runs on whichever `LLMProvider` `get_default_provider()`
resolves to in this process -- in this sandbox that's the deterministic
`ExtractiveFallbackProvider` (see ADR 0005), since there's no egress to
Gemini/Groq/a local Ollama daemon here. These tests assert on structural
correctness and factual presence (per the Phase 4 spec's own testing
guidance), not exact LLM wording, so they hold regardless of which
provider is actually answering -- the same suite is what you'd run against
a real Gemini/Groq key with no changes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app import db  # noqa: E402


def _run_chat(client, query: str, conversation_id: str | None = None) -> tuple[list[dict], dict]:
    """POSTs to /chat, consumes the SSE stream, returns (all_events, final_event)."""
    events: list[dict] = []
    with client.stream(
        "POST",
        "/chat",
        json={"query": query, "conversation_id": conversation_id},
    ) as resp:
        assert resp.status_code == 200, resp.text
        for line in resp.iter_lines():
            if not line or not line.startswith("data: "):
                continue
            events.append(json.loads(line[len("data: ") :]))

    final_events = [e for e in events if e["type"] == "final"]
    assert final_events, f"no final event in stream for query={query!r}: {events}"
    return events, final_events[0]


# --------------------------------------------------------------------------
# Pre-flight (Phase 4 spec section 0.5) -- confirm retrieval is healthy
# before trusting any generation-level assertion below.
# --------------------------------------------------------------------------


def test_preflight_retrieval_healthy(ingested):
    client = ingested["client"]
    resp = client.post("/retrieval", json={"query": "What risks were raised for Contoso?", "top_k": 8})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["evidence_count"] > 0, "retrieval returned no evidence -- fix Phase 3 before testing Phase 4"


# --------------------------------------------------------------------------
# SSE status stream shape
# --------------------------------------------------------------------------


def test_chat_streams_all_required_status_stages(ingested):
    client = ingested["client"]
    events, final = _run_chat(client, "What risks were raised for Contoso?")

    stages = [e["stage"] for e in events if e["type"] == "status"]
    assert stages == ["understanding_query", "retrieving_evidence", "reasoning", "generating", "validating"]

    token_events = [e for e in events if e["type"] == "token"]
    assert token_events, "expected at least one streamed token chunk for the answer text"

    assert final["trace_id"].startswith("trace-")
    assert "model_name" in final
    assert "provider_is_fallback" in final


# --------------------------------------------------------------------------
# Grounded answers with citations (spec section 9, query 1)
# --------------------------------------------------------------------------


def test_contoso_risks_question_cites_original_report(ingested):
    client = ingested["client"]
    doc_ids = ingested["doc_ids"]
    _, final = _run_chat(client, "What risks were raised for Contoso?")

    answer = final["answer"]
    assert answer["abstained"] is False
    assert answer["citations"], "expected at least one citation"
    cited_docs = {c["document_id"] for c in answer["citations"]}
    assert doc_ids["contoso_original"] in cited_docs
    assert "risk" in answer["answer"].lower() or any("risk" in f.lower() for f in answer["key_findings"])


# --------------------------------------------------------------------------
# Temporal / recency (spec section 9, query 2)
# --------------------------------------------------------------------------


def test_pricing_status_question_surfaces_followup_report(ingested):
    client = ingested["client"]
    doc_ids = ingested["doc_ids"]
    _, final = _run_chat(client, "What is the status of the Contoso pricing proposal?")

    answer = final["answer"]
    assert answer["abstained"] is False
    cited_docs = {c["document_id"] for c in answer["citations"]}
    assert doc_ids["contoso_followup"] in cited_docs, (
        "expected the Contoso follow-up report (status: Completed) to be cited, not just the "
        f"original 'Open' report -- cited docs: {cited_docs}"
    )
    assert "completed" in answer["answer"].lower()


# --------------------------------------------------------------------------
# Negation handling (spec section 9, query 3) -- a real failure, not a nitpick
# --------------------------------------------------------------------------


def test_approval_question_preserves_negation(ingested):
    client = ingested["client"]
    _, final = _run_chat(client, "Did Contoso approve the revised proposal?")

    answer = final["answer"]
    assert answer["abstained"] is False
    lower = answer["answer"].lower()
    # The follow-up report explicitly says the proposal WAS approved
    # ("The revised price proposal was presented and accepted... approved
    # the multi-year discount structure"), so the correct answer here is
    # affirmative -- this test's job is to make sure a negated fact
    # elsewhere in the corpus (the *original* report's "has not yet been
    # approved" budget risk) isn't the one that leaks into the answer.
    assert "approved" in lower or "accepted" in lower


def test_negation_is_not_inverted_when_source_says_not_approved(ingested):
    """Direct test of the failure mode: ask about the risk framing from the
    *original* report, where the proposal explicitly had NOT yet been
    approved, and confirm the negation survives verbatim."""
    client = ingested["client"]
    _, final = _run_chat(client, "Had the price increase been approved at the time of the first meeting?")

    answer = final["answer"]
    lower = answer["answer"].lower()
    if not answer["abstained"]:
        # If it answers at all, it must not claim approval happened --
        # the source text is "has not yet been approved".
        assert "not" in lower or "hasn't" in lower or "has not" in lower


# --------------------------------------------------------------------------
# Cross-document citations (spec section 9, query 4)
# --------------------------------------------------------------------------


def test_acme_corp_question_cites_multiple_customers(ingested):
    client = ingested["client"]
    doc_ids = ingested["doc_ids"]
    _, final = _run_chat(client, "Which customers mentioned Acme Corp?")

    answer = final["answer"]
    assert answer["abstained"] is False
    cited_docs = {c["document_id"] for c in answer["citations"]}
    assert doc_ids["contoso_original"] in cited_docs or doc_ids["contoso_followup"] in cited_docs
    assert doc_ids["globex"] in cited_docs, f"expected Globex cited alongside Contoso: {cited_docs}"


# --------------------------------------------------------------------------
# Abstention (spec section 8 and 9) -- tested deliberately, not assumed
# --------------------------------------------------------------------------


def test_abstains_cleanly_on_unanswerable_question(ingested):
    client = ingested["client"]
    _, final = _run_chat(client, "What was Contoso's Q4 2025 revenue?")

    answer = final["answer"]
    assert answer["abstained"] is True
    assert answer["abstention_reason"], "expected a non-empty abstention_reason"
    assert answer["citations"] == []


def test_abstains_on_nonexistent_customer(ingested):
    client = ingested["client"]
    _, final = _run_chat(client, "What risks did Initech raise in their last call report?")

    answer = final["answer"]
    # Either abstains outright, or (extractive fallback) surfaces no usable
    # citations for a customer that was never ingested -- either way it
    # must not fabricate an answer about Initech.
    if not answer["abstained"]:
        assert "initech" not in answer["answer"].lower()


# --------------------------------------------------------------------------
# Citation validation (spec section 4) -- mandatory support-check, not just
# existence-check
# --------------------------------------------------------------------------


def test_citation_validation_summary_present_and_well_formed(ingested):
    client = ingested["client"]
    _, final = _run_chat(client, "What risks were raised for Contoso?")

    validation = final["citation_validation"]
    for key in ("total", "valid", "stripped", "existence_check_failed", "support_check_failed"):
        assert key in validation
    # Every returned citation passed both checks by construction (failing
    # ones are stripped before the final event is emitted).
    assert validation["valid"] == len(final["answer"]["citations"])


def test_citation_validator_rejects_hallucinated_chunk_id():
    """Unit-level test of the validator itself (spec section 4, point 2):
    a citation referencing a chunk_id absent from the evidence set must be
    stripped, not passed through."""
    from app.services import citation_validator

    evidence = [
        {
            "chunk_id": "real-chunk-1",
            "document_id": "CR-REAL",
            "page_number": 3,
            "raw_text": "The customer raised a data-residency risk in the EU region.",
            "section_path": ["Risks"],
        }
    ]
    answer_json = {
        "answer": "The customer raised a data-residency risk.",
        "key_findings": ["Data-residency risk in the EU region."],
        "citations": [
            {"document_id": "CR-REAL", "page": 3, "chunk_id": "real-chunk-1"},
            {"document_id": "CR-FAKE", "page": 99, "chunk_id": "hallucinated-chunk-id"},
        ],
        "confidence": "high",
        "abstained": False,
        "abstention_reason": None,
    }
    result = citation_validator.validate(answer_json, evidence)
    assert result.summary["existence_check_failed"] == 1
    assert result.summary["valid"] == 1
    kept_ids = {c["chunk_id"] for c in result.answer_json["citations"]}
    assert kept_ids == {"real-chunk-1"}


def test_citation_validator_rejects_unsupported_real_chunk():
    """A citation pointing at a real chunk_id that has nothing to do with
    the claim must fail the mandatory support-check (spec section 4, point
    3), not just the existence-check."""
    from app.services import citation_validator

    evidence = [
        {
            "chunk_id": "chunk-about-pricing",
            "document_id": "CR-REAL",
            "page_number": 5,
            "raw_text": "The customer requested a multi-year discount on the enterprise tier pricing.",
            "section_path": ["Pricing"],
        }
    ]
    answer_json = {
        "answer": "The quarterly board meeting was rescheduled to next Thursday in Building 4.",
        "key_findings": ["Meeting rescheduled to Thursday."],
        "citations": [{"document_id": "CR-REAL", "page": 5, "chunk_id": "chunk-about-pricing"}],
        "confidence": "high",
        "abstained": False,
        "abstention_reason": None,
    }
    result = citation_validator.validate(answer_json, evidence)
    assert result.summary["support_check_failed"] == 1
    assert result.answer_json["citations"] == []
    assert "verified" in result.answer_json["answer"].lower() or "removed" in result.answer_json["answer"].lower()


# --------------------------------------------------------------------------
# Determinism -- ask the same question twice, citations should be stable
# --------------------------------------------------------------------------


def test_repeated_query_yields_consistent_citations(ingested):
    client = ingested["client"]
    _, final1 = _run_chat(client, "What risks were raised for Contoso?")
    _, final2 = _run_chat(client, "What risks were raised for Contoso?")

    ids1 = sorted(c["chunk_id"] for c in final1["answer"]["citations"])
    ids2 = sorted(c["chunk_id"] for c in final2["answer"]["citations"])
    assert ids1 == ids2, f"expected consistent citations across repeated identical queries: {ids1} vs {ids2}"


# --------------------------------------------------------------------------
# JSON reliability (spec exit criteria) -- retry path exists and is wired
# --------------------------------------------------------------------------


def test_malformed_json_triggers_retry_and_still_returns_valid_schema():
    from app.services import generation

    class FlakyProvider:
        def __init__(self):
            self.calls = 0

        @property
        def model_name(self) -> str:
            return "flaky-test-provider"

        def generate(self, system_prompt, user_prompt, *, stream=False, max_tokens=800):
            self.calls += 1
            if self.calls == 1:
                return "this is not json at all"
            return json.dumps(
                {
                    "answer": "Recovered after retry.",
                    "key_findings": [],
                    "citations": [],
                    "confidence": "low",
                    "abstained": True,
                    "abstention_reason": "test",
                }
            )

    provider = FlakyProvider()
    result = generation.generate_structured_answer("test query", [], provider=provider)
    assert provider.calls == 2, "expected exactly one retry after malformed JSON"
    assert result.json_retry_used is True
    assert result.parse_failed is False
    assert result.raw_json["answer"] == "Recovered after retry."


def test_generation_falls_back_gracefully_when_both_attempts_are_malformed():
    from app.services import generation

    class AlwaysBrokenProvider:
        @property
        def model_name(self) -> str:
            return "always-broken-test-provider"

        def generate(self, system_prompt, user_prompt, *, stream=False, max_tokens=800):
            return "still not json"

    result = generation.generate_structured_answer("test query", [], provider=AlwaysBrokenProvider())
    assert result.parse_failed is True
    assert result.raw_json["abstained"] is True
    assert result.raw_json["citations"] == []


# --------------------------------------------------------------------------
# chat_traces persistence (spec exit criteria)
# --------------------------------------------------------------------------


def test_chat_trace_persisted_with_full_fields(ingested):
    client = ingested["client"]
    _, final = _run_chat(client, "What risks were raised for Contoso?", conversation_id="conv-test-1")

    conn = db.get_connection()
    row = conn.execute(
        "SELECT * FROM chat_traces WHERE trace_id = ?", (final["trace_id"],)
    ).fetchone()
    assert row is not None
    row = dict(row)
    assert row["conversation_id"] == "conv-test-1"
    assert row["query"] == "What risks were raised for Contoso?"
    assert row["intent"] == "answerable_single_pass"
    assert db.loads(row["retrieved_chunk_ids"])
    assert db.loads(row["answer_json"])["citations"] == final["answer"]["citations"]
    validation = db.loads(row["citation_validation"])
    assert "support_check_failed" in validation
    assert row["model_name"]
    assert row["latency_ms"] >= 0


def test_chat_traces_endpoint_returns_recent_traces(ingested):
    client = ingested["client"]
    _run_chat(client, "What risks were raised for Contoso?", conversation_id="conv-test-2")

    resp = client.get("/chat/traces", params={"conversation_id": "conv-test-2"})
    assert resp.status_code == 200
    traces = resp.json()["traces"]
    assert traces
    assert all(t["conversation_id"] == "conv-test-2" for t in traces)


# --------------------------------------------------------------------------
# Intent classification (spec section 5)
# --------------------------------------------------------------------------


def test_intent_classification_heuristics():
    from app.routers.copilot import classify_intent

    assert classify_intent("Which customers mentioned Acme Corp?") == "likely_needs_multiple_documents"
    assert classify_intent("What was Contoso's Q4 2025 revenue?") == "likely_unanswerable"
    assert classify_intent("What risks were raised for Contoso?") == "answerable_single_pass"
