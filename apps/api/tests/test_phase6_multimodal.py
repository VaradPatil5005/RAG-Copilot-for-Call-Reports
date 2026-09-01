"""Phase 6.2 tests: routing rule correctness, and a figure-grounded
end-to-end retrieval/citation check.

This sandbox has no reachable Gemini API key (see ADR 0005), so the
end-to-end test runs on `OCRFallbackVisionProvider` -- it asserts the
fallback's honestly-labeled behavior (not a fabricated chart description
the sandbox has no way to actually produce), while the *routing* logic
and the *retrieval/citation* path are exercised for real either way.
"""
from __future__ import annotations

import io
import time
from pathlib import Path

import pytest

from app import db
from app.services import multimodal_extraction as mm


# --------------------------------------------------------------------------
# Routing rule (pure function -- Phase 6 spec: assert the decision itself)
# --------------------------------------------------------------------------


def _el(element_type, **kwargs):
    base = {
        "element_id": kwargs.pop("element_id", "doc:p1:e1"),
        "page_number": kwargs.pop("page_number", 1),
        "element_type": element_type,
    }
    base.update(kwargs)
    return base


def test_routing_flags_low_ocr_confidence_page():
    elements = [_el("paragraph", ocr=True, confidence=0.40, text="blurry scanned text")]
    decisions = mm.evaluate_routing(elements)
    assert len(decisions) == 1
    assert decisions[0].reason == "low_ocr_confidence"


def test_routing_flags_figure_with_no_usable_text():
    elements = [_el("figure", ocr=False, text="Figure extracted from page 8", figure_path="f8_1.png")]
    decisions = mm.evaluate_routing(elements)
    assert len(decisions) == 1
    assert decisions[0].reason == "figure_no_usable_text"


def test_routing_flags_low_cell_count_table():
    elements = [
        _el(
            "table",
            table_json={"headers": ["Only"], "rows": [], "row_count": 0, "col_count": 1},
        )
    ]
    decisions = mm.evaluate_routing(elements)
    assert len(decisions) == 1
    assert decisions[0].reason == "table_extraction_failed_or_low_cells"


def test_routing_does_not_flag_a_normal_clean_page():
    """The negative case the spec explicitly asks for: a normal clean text
    page must NOT be routed."""
    elements = [
        _el("paragraph", ocr=False, confidence=0.98, text="The customer requested a revised price proposal."),
        _el(
            "table",
            table_json={
                "headers": ["Metric", "Q1", "Q2"],
                "rows": [["Pipeline", "850000", "1250000"]],
                "row_count": 1,
                "col_count": 3,
            },
        ),
        _el("figure", ocr=True, text="Q1 Q2 Q3 pipeline trend chart axis labels", figure_path="f1.png"),
    ]
    decisions = mm.evaluate_routing(elements)
    assert decisions == []


# --------------------------------------------------------------------------
# Vision provider fallback labeling
# --------------------------------------------------------------------------


def test_ocr_fallback_vision_provider_labels_unavailability():
    provider = mm.OCRFallbackVisionProvider()
    with_hint = provider.describe_image(b"", "image/png", "describe this", ocr_hint="Q1 Q2 Q3 rising trend")
    assert "vision model unreachable" in with_hint
    assert "Q1 Q2 Q3" in with_hint

    no_hint = provider.describe_image(b"", "image/png", "describe this", ocr_hint="")
    assert "could not be described" in no_hint


def test_default_vision_provider_is_the_fallback_in_this_sandbox():
    """No GEMINI_API_KEY / network in this environment -- documents the
    actual active path, same pattern as generation.provider_is_fallback()
    in test_phase5.py."""
    mm.reset_vision_provider_cache()
    assert mm.vision_provider_is_fallback() is True
    assert isinstance(mm.get_default_vision_provider(), mm.OCRFallbackVisionProvider)


# --------------------------------------------------------------------------
# End-to-end: a chart page with no OCR-readable text, through the real
# ingestion pipeline, retrieved and cited correctly.
# --------------------------------------------------------------------------


def _build_figure_pdf(path: Path) -> None:
    """A single-page PDF: one heading paragraph (so the section/customer
    context is unambiguous) plus an embedded PNG with no text at all (a
    plain color gradient) -- Tesseract will extract nothing from it, so
    the routing rule's 'figure_no_usable_text' branch fires for real."""
    from PIL import Image as PILImage
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Image as RLImage
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    img_path = path.with_suffix(".chart.png")
    img = PILImage.new("RGB", (400, 200))
    for x in range(400):
        for y in range(200):
            img.putpixel((x, y), (x % 256, y % 256, (x + y) % 256))
    img.save(img_path)

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16)
    doc = SimpleDocTemplate(str(path), pagesize=letter, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
    flow = [
        Paragraph("Pipeline Trend Chart", h1),
        Spacer(1, 12),
        RLImage(str(img_path), width=4 * inch, height=2 * inch),
    ]
    doc.build(flow)


@pytest.fixture(scope="module")
def figure_doc(ingested, tmp_path_factory):
    client = ingested["client"]
    tmp_dir = tmp_path_factory.mktemp("figure_pdf")
    pdf_path = tmp_dir / "CR-2026-FIGURE_Northwind.pdf"
    _build_figure_pdf(pdf_path)

    with open(pdf_path, "rb") as f:
        resp = client.post(
            "/documents/upload",
            files={"files": (pdf_path.name, f, "application/pdf")},
            data={
                "customer_name": "Northwind",
                "account_owner": "dave",
                "meeting_date": "2026-07-01",
                "classification": "confidential",
            },
        )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["results"][0]["document_id"]

    deadline = time.time() + 120
    terminal = {"completed", "failed", "dead_lettered", "quarantined"}
    status = None
    while time.time() < deadline:
        status = client.get(f"/documents/{document_id}").json()["latest"]["status"]
        if status in terminal:
            break
        time.sleep(1)
    assert status == "completed", f"figure doc ended in status={status}"
    return {"client": client, "document_id": document_id}


def test_figure_page_is_routed_and_gets_a_labeled_description(figure_doc):
    conn = db.get_connection()
    row = db.row_to_dict(
        conn.execute(
            "SELECT chunk_id, raw_text, page_number FROM chunks WHERE document_id = ? AND chunk_type = 'figure'",
            (figure_doc["document_id"],),
        ).fetchone()
    )
    assert row is not None, "expected a figure chunk for the routed chart page"
    # This sandbox has no reachable vision model -- the chunk content must
    # honestly say so, not fabricate a plausible-sounding chart description.
    assert "vision model unreachable" in (row["raw_text"] or "")
    assert row["page_number"] == 1


def test_figure_grounded_question_retrieves_and_cites_the_figure_chunk(figure_doc):
    client = figure_doc["client"]
    resp = client.post(
        "/search",
        json={"query": "pipeline trend chart Northwind", "top_k": 10, "filters": {"customer": "Northwind"}},
    )
    assert resp.status_code == 200, resp.text
    results = resp.json().get("results", [])
    figure_hits = [r for r in results if r.get("chunk_type") == "figure"]
    assert figure_hits, f"expected the figure chunk in results, got: {[r.get('chunk_type') for r in results]}"
    assert figure_hits[0]["page_number"] == 1
    assert figure_hits[0]["document_id"] == figure_doc["document_id"]


def test_routing_avoids_processing_most_ordinary_text_pages(ingested):
    """Exit criterion: routing correctly avoids processing the majority of
    ordinary text pages on the test corpus (the three plain-text sample
    reports, which have no figures and no low-confidence OCR)."""
    conn = db.get_connection()
    for doc_id in ingested["doc_ids"].values():
        events = db.rows_to_list(
            conn.execute(
                "SELECT message FROM processing_events WHERE document_id = ? AND stage = 'multimodal_extraction' "
                "AND status = 'completed'",
                (doc_id,),
            ).fetchall()
        )
        assert events, f"no multimodal_extraction completion event for {doc_id}"
        # e.g. "0/14 elements routed (0/3 pages, 0.0%, extractor=...)"
        assert "0/" in events[0]["message"].split(" elements routed")[0]
