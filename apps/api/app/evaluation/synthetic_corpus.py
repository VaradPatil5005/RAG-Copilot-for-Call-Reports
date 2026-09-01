"""Larger synthetic call-report corpus generator (Phase 6.4).

The Phase 1-5 sample corpus (3 documents: Contoso x2, Globex x1 -- see
tests/conftest.py) is too small to support 300 genuinely distinct,
non-trivial gold queries; padding a tiny corpus with near-duplicate
questions just to hit a number would not be a real benchmark. Per the
Phase 6 spec's own instruction, this module generates a larger synthetic
corpus first, with **known ground truth** (since the content is generated,
the "gold answer" is exactly what was written into the PDF) -- 20
customers x 2 reports (original + followup) = 40 documents, sized to
support the blueprint's 300-query stratification without duplication.

This is still synthetic, programmatically-generated content, not a real
100K-document enterprise corpus or SME-authored gold data -- documented
here and in the resulting ADR exactly like every other local-dev
substitution in this project. What it *does* give a real signal on:
whether retrieval/generation/citation behave correctly at 40-document,
multi-customer, multi-version scale, which the 3-document corpus could not
exercise (e.g. entity-comparison across many customers, a competitor
mentioned by more than 2 customers, aggregation across >2 reports).

Reuses the exact reportlab-based PDF construction already established in
tests/conftest.py's `_build_sample_pdfs`, parameterized and seeded for
reproducibility instead of hand-written per-document.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path

CUSTOMER_NAMES = [
    "Contoso", "Globex", "Initech", "Umbrella", "Wayne Enterprises", "Stark Industries",
    "Wonka Industries", "Aperture Science", "Cyberdyne Systems", "Soylent Corp",
    "Hooli", "Pied Piper", "Massive Dynamic", "Gringotts", "Oscorp",
    "Tyrell Corporation", "Weyland-Yutani", "Genco Pura", "Nakatomi Trading", "Vandelay Industries",
    "Sirius Cybernetics", "Buy N Large", "Duff Brewing", "Prestige Worldwide", "Wentworth Digital",
    "Blackwood Analytics", "Ferris Manufacturing", "Kettleman Foods", "Sterling Cooper", "Axiom Robotics",
]

COMPETITOR_POOL = ["Acme Corp", "Zenith Systems", "Bluewave Technologies", "Northstar Solutions"]

OWNER_POOL = ["alice", "bob", "carol", "dave", "erin", "frank"]

RISK_TEMPLATES = [
    "a budget approval delay on the {customer} side",
    "concern about the implementation timeline slipping past Q{q}",
    "a competing internal project that could deprioritize this initiative",
    "uncertainty about data migration effort from the legacy system",
    "a key stakeholder departure that could stall the decision",
]

ACTION_TEMPLATES = [
    "Send the revised pricing proposal",
    "Schedule a technical deep-dive with the security team",
    "Share the implementation timeline document",
    "Follow up on the outstanding legal review",
    "Provide updated ROI figures for the executive sponsor",
]


@dataclass
class CustomerProfile:
    customer: str
    owner: str
    competitors: list[str]
    risks: list[str]
    actions: list[tuple[str, str, str]]  # (owner, action, due_date)
    pipeline_q1: int
    pipeline_q2: int
    meeting_date_original: str
    meeting_date_followup: str
    approved_original: bool
    approved_followup: bool


def generate_customer_profiles(n: int = 20, seed: int = 42) -> list[CustomerProfile]:
    rng = random.Random(seed)
    profiles = []
    for i, name in enumerate(CUSTOMER_NAMES[:n]):
        owner = OWNER_POOL[i % len(OWNER_POOL)]
        n_competitors = rng.choice([1, 1, 2])
        competitors = rng.sample(COMPETITOR_POOL, n_competitors)
        risks = [RISK_TEMPLATES[j].format(customer=name, q=rng.choice([2, 3, 4])) for j in rng.sample(range(len(RISK_TEMPLATES)), 2)]
        actions = [
            (rng.choice(OWNER_POOL), ACTION_TEMPLATES[j], f"2026-{rng.randint(6,9):02d}-{rng.randint(1,28):02d}")
            for j in rng.sample(range(len(ACTION_TEMPLATES)), 2)
        ]
        pipeline_q1 = rng.randint(200, 900) * 1000
        pipeline_q2 = pipeline_q1 + rng.randint(-100, 400) * 1000
        approved_original = False
        approved_followup = rng.random() > 0.4
        profiles.append(
            CustomerProfile(
                customer=name,
                owner=owner,
                competitors=competitors,
                risks=risks,
                actions=actions,
                pipeline_q1=pipeline_q1,
                pipeline_q2=max(pipeline_q2, 50_000),
                meeting_date_original=f"2026-{4 + i % 3:02d}-{5 + i % 20:02d}",
                meeting_date_followup=f"2026-{6 + i % 3:02d}-{5 + i % 20:02d}",
                approved_original=approved_original,
                approved_followup=approved_followup,
            )
        )
    return profiles


def _build_pdf(path: Path, profile: CustomerProfile, report: str) -> None:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=14)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, leading=14)

    is_followup = report == "followup"
    approved = profile.approved_followup if is_followup else profile.approved_original
    meeting_date = profile.meeting_date_followup if is_followup else profile.meeting_date_original

    flow = [Paragraph(f"Call Report -- {profile.customer} ({'Follow-up' if is_followup else 'Initial'} Meeting)", h1), Spacer(1, 12)]

    flow.append(Paragraph("Discussion", h2))
    competitor_text = " and ".join(profile.competitors)
    flow.append(
        Paragraph(
            f"{profile.customer} discussed their evaluation criteria and mentioned {competitor_text} "
            f"as {'a competing vendor' if len(profile.competitors) == 1 else 'competing vendors'} "
            f"under consideration.",
            body,
        )
    )
    flow.append(Spacer(1, 8))
    flow.append(
        Paragraph(
            f"The customer {'confirmed approval of the proposal' if approved else 'has not yet approved the proposal'} "
            f"as of this meeting on {meeting_date}.",
            body,
        )
    )

    flow.append(Spacer(1, 10))
    flow.append(Paragraph("Risks", h2))
    for r in profile.risks:
        flow.append(Paragraph(f"The team flagged {r}.", body))
        flow.append(Spacer(1, 4))

    flow.append(Spacer(1, 10))
    flow.append(Paragraph("Open Actions", h2))
    headers = ["Owner", "Action", "Due Date"]
    rows = [[o, a, d] for o, a, d in profile.actions]
    table = Table([headers] + rows, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), "#dddddd"),
                ("GRID", (0, 0), (-1, -1), 0.5, "#999999"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    flow.append(table)

    flow.append(Spacer(1, 10))
    flow.append(Paragraph("Pipeline Summary", h2))
    metric_headers = ["Metric", "Q1-2026", "Q2-2026"]
    metric_rows = [["Pipeline", f"${profile.pipeline_q1:,}", f"${profile.pipeline_q2:,}"]]
    metric_table = Table([metric_headers] + metric_rows, hAlign="LEFT")
    metric_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), "#dddddd"),
                ("GRID", (0, 0), (-1, -1), 0.5, "#999999"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    flow.append(metric_table)

    doc = SimpleDocTemplate(str(path), pagesize=letter, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
    doc.build(flow)


@dataclass
class GeneratedDocument:
    profile: CustomerProfile
    report: str  # "original" | "followup"
    path: Path


def generate_corpus(output_dir: Path, n_customers: int = 20, seed: int = 42) -> tuple[list[CustomerProfile], list[GeneratedDocument]]:
    """Writes 2*n_customers PDFs to `output_dir` and returns (profiles,
    generated_documents) -- the ground truth `gold_queries_v2.py` builds
    the stratified query set from, and the metadata the caller uploads
    each PDF with (customer_name, account_owner, meeting_date)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    profiles = generate_customer_profiles(n_customers, seed=seed)
    docs = []
    for profile in profiles:
        for report in ("original", "followup"):
            fname = f"SYN-{profile.customer.replace(' ', '_')}-{report}.pdf"
            path = output_dir / fname
            _build_pdf(path, profile, report)
            docs.append(GeneratedDocument(profile=profile, report=report, path=path))
    return profiles, docs
