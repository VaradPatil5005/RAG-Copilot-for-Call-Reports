"""Shared fixtures for the Phase 3 retrieval test suite.

Tests run against the real (file-backed) SQLite metadata store, FTS5
index, and hnswlib vector index under `apps/api/data/` -- there's no env-
var override for those paths (see db.py / storage.py), so this conftest
wipes `data/` before the session starts and re-ingests three synthetic
call-report PDFs through the real pipeline (upload -> validate -> extract
-> normalize -> chunk -> embed -> index), the same path production
traffic takes. This is slower than mocking, but it's what the Phase 3
build prompt asks for: verify chunking/embeddings/search against actual
ingested sample PDFs, not fixtures that skip the pipeline.

If a `huggingface.co`-reachable network is available, ingestion uses real
fastembed embeddings/reranking; otherwise it uses the documented fallback
providers (see ADR 0004) and `embedding_provider` in the retrieval trace
reflects that. Either way, chunking/BM25/HNSW/RRF/diversification/parent-
child expansion are exercised for real.
"""
from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

DATA_DIR = API_ROOT / "data"


def _wipe_data_dir() -> None:
    """Deletes `data/` before a fresh test session, tolerating Windows'
    file-locking semantics -- unlike POSIX, Windows refuses to delete a
    file that's still open anywhere (this same process from an earlier,
    not-fully-torn-down run; or a `uvicorn` dev server left running in
    another terminal). Closes this process's own SQLite handle first
    (the common case), then retries the rmtree a few times with a short
    pause -- covers a lingering external process releasing its handle
    shortly after, or antivirus/indexing briefly holding the file."""
    if not DATA_DIR.exists():
        return
    try:
        from app import db as _db

        _db.close_connection()
    except ImportError:
        pass  # app.db hasn't been imported yet in this process -- nothing to close

    last_exc: Exception | None = None
    for attempt in range(5):
        try:
            shutil.rmtree(DATA_DIR)
            return
        except (PermissionError, OSError) as exc:
            last_exc = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(
        f"Could not delete {DATA_DIR} after retries -- on Windows this almost always "
        "means another process (e.g. `uvicorn app.main:app` left running in another "
        "terminal) still has a file in it open. Stop that process and re-run."
    ) from last_exc


def _build_sample_pdfs(out_dir: Path) -> dict[str, Path]:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=14)
    h3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=12)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, leading=14)

    def build(path: Path, title: str, sections) -> None:
        doc = SimpleDocTemplate(str(path), pagesize=letter, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
        flow = [Paragraph(title, h1), Spacer(1, 12)]
        for sec_title, level, content in sections:
            style = h2 if level == 2 else h3
            flow.append(Paragraph(sec_title, style))
            flow.append(Spacer(1, 6))
            if content is None:
                pass
            elif isinstance(content, str):
                flow.append(Paragraph(content, body))
            else:
                headers, rows = content
                data = [headers] + rows
                t = Table(data, repeatRows=1)
                t.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dddddd")),
                            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                            ("FONTSIZE", (0, 0), (-1, -1), 8),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ]
                    )
                )
                flow.append(t)
            flow.append(Spacer(1, 14))
        doc.build(flow)

    sections_123 = [
        ("Customer Meeting", 2, "Meeting held with Contoso account team to discuss Q2 renewal and expansion opportunities. Attendees included the VP of Procurement and the IT Director."),
        ("Discussion", 2, None),
        ("Pricing", 3, "The customer requested a revised price proposal for the enterprise tier, citing budget constraints for the upcoming fiscal year. They asked whether a multi-year discount could be applied."),
        ("Competitive Landscape", 3, "Contoso mentioned they are also evaluating Acme Corp as an alternative vendor for the same workload, citing Acme Corp's lower list price."),
        ("Risks", 2, "Several risks were raised: (1) implementation-timing risk, since Contoso's internal IT freeze begins in six weeks; (2) budget risk, since the proposed price increase has not yet been approved; (3) competitive risk from Acme Corp's aggressive pricing."),
        ("Pipeline Summary", 2, (
            ["Metric", "Q1-2026", "Q2-2026", "Status"],
            [
                ["Pipeline Value (USD)", "850000", "1250000", "Open"],
                ["Renewal Probability", "60%", "72%", "Open"],
                ["Expansion Seats", "40", "65", "Open"],
            ],
        )),
        ("Actions", 2, "Alice to send the revised proposal by 2026-06-01. Bob to prepare the Acme Corp competitive brief by 2026-05-25. Status: Open."),
        ("Next Steps", 2, "Schedule a follow-up call in three weeks to review the revised proposal and confirm the implementation timeline."),
    ]
    sections_456 = [
        ("Customer Meeting", 2, "Follow-up meeting with Contoso to close out the pricing discussion from the prior call. Joined by Contoso's CFO."),
        ("Discussion", 2, None),
        ("Pricing", 3, "The revised price proposal was presented and accepted. The customer approved the multi-year discount structure. The Contoso pricing proposal status is now Completed, with the signed order form expected by end of week."),
        ("Risks", 2, "The implementation-timing risk from the prior report has been resolved; Contoso's IT freeze was pushed back by one month. Budget risk is closed now that finance has approved the increase."),
        ("Pipeline Summary", 2, (
            ["Metric", "Q2-2026", "Status"],
            [
                ["Pipeline Value (USD)", "1250000", "Closed-Won"],
                ["Renewal Probability", "100%", "Closed-Won"],
                ["Expansion Seats", "65", "Confirmed"],
            ],
        )),
        ("Actions", 2, "Alice to countersign the order form by 2026-06-10. Status: Open."),
        ("Next Steps", 2, "Kick off implementation planning once the signed order form is received."),
    ]
    sections_789 = [
        ("Customer Meeting", 2, "Quarterly business review with Globex Corporation covering platform adoption and renewal outlook."),
        ("Discussion", 2, None),
        ("Competitive Landscape", 3, "Globex noted that their security team has also been briefed by Acme Corp as part of a routine vendor evaluation, though Globex indicated no near-term plan to switch."),
        ("Risks", 2, "Globex flagged a data-residency risk: their new compliance policy may require EU-only data storage, which the current deployment does not yet support. This is an open risk with no resolution date."),
        ("Pipeline Summary", 2, (
            ["Metric", "Q2-2026", "Status"],
            [
                ["Pipeline Value (USD)", "430000", "Open"],
                ["Renewal Probability", "55%", "Open"],
            ],
        )),
        ("Actions", 2, "Carol to confirm EU data-residency roadmap with product team by 2026-06-15. Status: Open."),
        ("Next Steps", 2, "Share the EU data-residency roadmap update at the next QBR."),
    ]

    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "contoso_original": out_dir / "CR-2026-000123_Contoso.pdf",
        "contoso_followup": out_dir / "CR-2026-000456_Contoso_Followup.pdf",
        "globex": out_dir / "CR-2026-000789_Globex.pdf",
    }
    build(paths["contoso_original"], "Call Report — Contoso — 2026-05-17", sections_123)
    build(paths["contoso_followup"], "Call Report — Contoso Follow-up — 2026-05-31", sections_456)
    build(paths["globex"], "Call Report — Globex — 2026-06-02", sections_789)
    return paths


@pytest.fixture(scope="session")
def sample_pdf_paths(tmp_path_factory) -> dict[str, Path]:
    out_dir = tmp_path_factory.mktemp("sample_pdfs")
    return _build_sample_pdfs(out_dir)


@pytest.fixture(scope="session")
def ingested(sample_pdf_paths):
    """Wipes apps/api/data, boots the real app, uploads the three sample
    PDFs, and blocks until every one reaches a terminal status. Yields a
    dict with the TestClient and a name->document_id map for use across
    the whole test session (ingestion is the expensive part -- ~seconds
    per doc -- so it happens once).

    Phase 6.3: every request now requires a verified bearer token (see
    `app.services.auth`) -- there is no more client-supplied `principals`/
    `tenant_id` request-body field to set directly. The client's default
    Authorization header carries a broad "tenant:tenant-a" token (minted
    via the real `/auth/dev-token` local-dev endpoint, not by hand-
    encoding a JWT, so this exercises the actual issuance+verification
    path), which is authorized for everything in tenant-a -- the same
    breadth the old default `principals=None`/implicit-tenant-a behavior
    had. Tests that need a narrower or different identity mint their own
    token via the `mint_token` fixture and pass a per-call header
    override, which takes precedence over the client's default."""
    _wipe_data_dir()
    DATA_DIR.mkdir(parents=True)

    # Reset any module-level singletons from a previous test process run
    # in the same interpreter (index manager, embedding provider cache).
    for mod_name in list(sys.modules):
        if mod_name.startswith("app."):
            del sys.modules[mod_name]

    from starlette.testclient import TestClient

    from app.main import app
    from app.services import auth as auth_service

    client = TestClient(app)
    client.__enter__()

    default_token = auth_service.create_dev_token(
        sub="test-runner",
        tenant_id="tenant-a",
        principals=["tenant:tenant-a", "owner:alice", "owner:carol", "customer:Contoso", "customer:Globex"],
    )
    client.headers.update({"Authorization": f"Bearer {default_token}"})

    metas = [
        ("contoso_original", "CR-2026-000123_Contoso.pdf", "Contoso", "alice", "2026-05-17"),
        ("contoso_followup", "CR-2026-000456_Contoso_Followup.pdf", "Contoso", "alice", "2026-05-31"),
        ("globex", "CR-2026-000789_Globex.pdf", "Globex", "carol", "2026-06-02"),
    ]
    doc_ids: dict[str, str] = {}
    for key, fname, customer, owner, date in metas:
        path = sample_pdf_paths[key]
        with open(path, "rb") as f:
            resp = client.post(
                "/documents/upload",
                files={"files": (fname, f, "application/pdf")},
                data={
                    "customer_name": customer,
                    "account_owner": owner,
                    "meeting_date": date,
                    "classification": "confidential",
                },
            )
        assert resp.status_code == 200, resp.text
        doc_ids[key] = resp.json()["results"][0]["document_id"]

    deadline = time.time() + 180
    terminal = {"completed", "failed", "dead_lettered", "quarantined"}
    while time.time() < deadline:
        statuses = {k: client.get(f"/documents/{v}").json()["latest"]["status"] for k, v in doc_ids.items()}
        if all(s in terminal for s in statuses.values()):
            break
        time.sleep(1)
    else:
        pytest.fail(f"Ingestion did not complete in time: {statuses}")

    for k, v in doc_ids.items():
        status = client.get(f"/documents/{v}").json()["latest"]["status"]
        assert status == "completed", f"{k} ({v}) ended in status={status}"

    yield {"client": client, "doc_ids": doc_ids}
    client.__exit__(None, None, None)


@pytest.fixture(scope="session")
def mint_token():
    """Returns a function(sub, tenant_id="tenant-a", principals=None) ->
    {"Authorization": "Bearer ..."} header dict, for tests that need an
    identity narrower or different from the `ingested` fixture's default
    broad tenant-level token -- e.g. testing that ACL enforcement actually
    restricts an owner-scoped or cross-tenant caller."""
    from app.services import auth as auth_service

    def _mint(sub: str, tenant_id: str = "tenant-a", principals: list[str] | None = None) -> dict[str, str]:
        token = auth_service.create_dev_token(sub=sub, tenant_id=tenant_id, principals=principals or [])
        return {"Authorization": f"Bearer {token}"}

    return _mint
