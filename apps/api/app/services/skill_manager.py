"""Procedural Financial Skills Engine (Phase E Extension).

Manages reusable analytical workflows, query-pattern matching, prompt injection,
and autonomous skill synthesis from high-performing query traces.

All skills are partitioned by tenant_id.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app import db

logger = logging.getLogger("copilot.skills")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Skill Management CRUD
# --------------------------------------------------------------------------


def list_skills(tenant_id: str, state: str | None = None) -> list[dict[str, Any]]:
    """Returns all skills for the tenant, optionally filtered by state."""
    conn = db.get_connection()
    if state:
        rows = conn.execute(
            """
            SELECT * FROM procedural_skills
            WHERE tenant_id = ? AND state = ?
            ORDER BY use_count DESC, updated_at DESC
            """,
            (tenant_id, state),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT * FROM procedural_skills
            WHERE tenant_id = ?
            ORDER BY use_count DESC, updated_at DESC
            """,
            (tenant_id,),
        ).fetchall()

    out = []
    for r in db.rows_to_list(rows):
        r["trigger_phrases"] = db.loads(r.get("trigger_phrases"), [])
        out.append(r)
    return out


def get_skill(skill_id: str, tenant_id: str) -> dict[str, Any] | None:
    """Fetches a single skill by ID."""
    conn = db.get_connection()
    row = conn.execute(
        "SELECT * FROM procedural_skills WHERE skill_id = ? AND tenant_id = ?",
        (skill_id, tenant_id),
    ).fetchone()
    if not row:
        return None
    d = db.row_to_dict(row)
    if d:
        d["trigger_phrases"] = db.loads(d.get("trigger_phrases"), [])
    return d


def upsert_skill(
    tenant_id: str,
    name: str,
    description: str,
    category: str,
    trigger_phrases: list[str],
    procedure_markdown: str,
    verification_rule: str | None = None,
    created_by: str = "system",
    state: str = "active",
) -> str:
    """Inserts or updates a procedural financial skill."""
    now = _now()
    skill_id = f"skill-{uuid.uuid4().hex[:10]}"
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO procedural_skills (
                skill_id, tenant_id, name, description, category, trigger_phrases,
                procedure_markdown, verification_rule, use_count, state,
                created_by, last_used_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
            ON CONFLICT(tenant_id, name) DO UPDATE SET
                description = excluded.description,
                category = excluded.category,
                trigger_phrases = excluded.trigger_phrases,
                procedure_markdown = excluded.procedure_markdown,
                verification_rule = excluded.verification_rule,
                state = excluded.state,
                updated_at = excluded.updated_at
            """,
            (
                skill_id,
                tenant_id,
                name,
                description,
                category,
                db.dumps(trigger_phrases),
                procedure_markdown,
                verification_rule,
                state,
                created_by,
                now,
                now,
            ),
        )
    return skill_id


def update_skill_state(skill_id: str, new_state: str, tenant_id: str) -> bool:
    """Updates skill state ('active', 'stale', 'archived')."""
    now = _now()
    with db.tx() as conn:
        res = conn.execute(
            "UPDATE procedural_skills SET state = ?, updated_at = ? WHERE skill_id = ? AND tenant_id = ?",
            (new_state, now, skill_id, tenant_id),
        )
        return res.rowcount > 0


def record_skill_usage(skill_id: str, tenant_id: str) -> None:
    """Increments use count and updates last_used_at timestamp."""
    now = _now()
    with db.tx() as conn:
        conn.execute(
            """
            UPDATE procedural_skills
            SET use_count = use_count + 1, last_used_at = ?, updated_at = ?
            WHERE skill_id = ? AND tenant_id = ?
            """,
            (now, now, skill_id, tenant_id),
        )


# --------------------------------------------------------------------------
# Trigger Matching & Prompt Injection
# --------------------------------------------------------------------------


def match_skill_for_query(query: str, tenant_id: str) -> dict[str, Any] | None:
    """Matches an incoming user query against active skills' trigger phrases."""
    q_lower = query.lower()
    skills = list_skills(tenant_id, state="active")
    for s in skills:
        for phrase in s.get("trigger_phrases", []):
            if phrase.lower() in q_lower:
                return s
    return None


def format_skill_for_prompt(skill: dict[str, Any]) -> str:
    """Formats the matched skill into procedural instructions for LLM execution."""
    lines = [
        f"[ACTIVE PROCEDURAL FINANCIAL SKILL: {skill['name'].upper()}]",
        f"DESCRIPTION: {skill.get('description', '')}",
        "PROCEDURAL EXECUTION STEPS:",
        skill.get("procedure_markdown", "").strip(),
    ]
    if skill.get("verification_rule"):
        lines.append(f"VERIFICATION CRITERIA: {skill['verification_rule'].strip()}")
    lines.append("[END PROCEDURAL SKILL -- execute these analytical steps directly]\n")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Seed Defaults & Autonomous Synthesis
# --------------------------------------------------------------------------


def seed_default_skills_if_empty(tenant_id: str = "tenant-a") -> None:
    """Seeds foundational enterprise credit analysis skills."""
    conn = db.get_connection()
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM procedural_skills WHERE tenant_id = ?", (tenant_id,)
    ).fetchone()["c"]
    if count > 0:
        return

    upsert_skill(
        tenant_id=tenant_id,
        name="covenant-compliance-audit",
        description="Audits loan covenant compliance, DSCR and leverage ratios against credit agreements.",
        category="covenant_audit",
        trigger_phrases=[
            "covenant compliance",
            "covenant breach",
            "ratio headroom",
            "dscr covenant",
            "leverage ratio covenant",
            "financial covenants",
        ],
        procedure_markdown="""\
1. Locate the financial summary table or ratio disclosure chunk for the borrower.
2. Extract Trailing-Twelve-Month (TTM) Adjusted EBITDA, Total Senior Debt, and Net Interest Expense.
3. Calculate Debt Service Coverage Ratio (DSCR = EBITDA / Total Debt Service) and Senior Leverage Ratio (Debt / EBITDA).
4. Extract covenant ceiling/floor limits from the credit facility agreement section.
5. Compute covenant headroom: Headroom % = (Covenant Limit - Actual Ratio) / Covenant Limit.
6. Render an exact comparative table and declare Pass, Warning (<15% headroom), or Breach.""",
        verification_rule="Every ratio numerator and denominator must cite exact document ID, page, and table coordinates.",
        created_by="system",
    )

    upsert_skill(
        tenant_id=tenant_id,
        name="quarterly-debt-trajectory",
        description="Analyzes chronological debt trajectory, borrowing facility draws, and maturity profiles.",
        category="debt_analysis",
        trigger_phrases=[
            "debt trajectory",
            "compare debt between",
            "debt maturity schedule",
            "borrowing comparison",
            "facility drawdown trend",
        ],
        procedure_markdown="""\
1. Retrieve call reports across both chronological periods for the borrower.
2. Extract Revolving Credit Facility drawn amounts, Term Loan balances, and interest spreads.
3. Compare period-over-period debt expansion/contraction in absolute dollars and percentage change.
4. Check upcoming debt maturities within the next 12 to 24 months.
5. Identify any credit rating changes or margin step-ups triggered by borrowing levels.""",
        verification_rule="Must cite both chronological documents and verify no negation flip occurred in covenant status.",
        created_by="system",
    )

    upsert_skill(
        tenant_id=tenant_id,
        name="multi-document-risk-synthesis",
        description="Cross-examines operational, legal, and credit risks across chronological call reports.",
        category="risk_synthesis",
        trigger_phrases=[
            "risk synthesis",
            "cross report risks",
            "compare risk factors",
            "operational risks across",
            "risk escalation",
        ],
        procedure_markdown="""\
1. Traverse GraphRAG edges with predicate HAS_RISK for the target enterprise account.
2. Cross-reference narrative risk chunks against structured Action Item tables.
3. Detect status transitions: newly emerged risks, active ongoing risks, or resolved concerns.
4. Surface competitor pressures (MENTIONED_COMPETITOR edges) impacting customer churn or pricing.""",
        verification_rule="Categorize all synthesized risks by severity (High, Medium, Low) and cite original report pages.",
        created_by="system",
    )


def synthesize_skill_from_trace(trace_id: str, tenant_id: str) -> str | None:
    """Autonomously synthesizes a procedural skill from a high-confidence, verified trace."""
    conn = db.get_connection()
    row = conn.execute(
        """
        SELECT t.query, t.answer_json, q.category
        FROM chat_traces t
        LEFT JOIN query_router_decisions q ON q.trace_id = t.trace_id
        WHERE t.trace_id = ? AND t.tenant_id = ? AND t.confidence = 'high' AND t.abstained = 0
        """,
        (trace_id, tenant_id),
    ).fetchone()

    if not row:
        return None

    query = row["query"]
    category = row["category"] or "analytical_procedure"
    ans = db.loads(row["answer_json"], {})

    # Only synthesize for complex multi-hop or comparison questions with >= 2 citations
    citations = ans.get("citations", [])
    if len(citations) < 2 or category not in ("comparison", "trend", "multi_hop"):
        return None

    skill_name = f"auto-{category}-{uuid.uuid4().hex[:6]}"
    desc = f"Autonomously synthesized procedure for {category} analysis: {query[:50]}"
    trigger_phrases = [query.lower()[:60]]
    steps = f"1. Identify comparative parameters from user query.\n2. Extract grounded evidence from verified reports.\n3. Execute period-over-period variance calculation.\n4. Format structured findings with citations."

    skill_id = upsert_skill(
        tenant_id=tenant_id,
        name=skill_name,
        description=desc[:80],
        category=category,
        trigger_phrases=trigger_phrases,
        procedure_markdown=steps,
        verification_rule="Verify all cited metrics against source chunks.",
        created_by="autonomous_agent",
    )
    logger.info("Autonomously synthesized procedural skill %s from trace %s", skill_id, trace_id)
    return skill_id
