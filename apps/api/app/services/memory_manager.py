"""Persistent Memory Manager (Phase E Extension).

Provides multi-tier persistent memory:
1. User Memory: Analyst-specific preferences, risk tolerance, sector focus, reporting styles.
2. Tenant Memory: Enterprise-wide credit policy, accounting standards, compliance mandates.

All memory operations are strictly partitioned by tenant_id.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app import db

logger = logging.getLogger("copilot.memory")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------
# User Memory CRUD
# --------------------------------------------------------------------------


def get_user_memories(
    tenant_id: str,
    user_id: str,
    category: str | None = None,
) -> list[dict[str, Any]]:
    """Retrieves all active memory items for a specific analyst user."""
    conn = db.get_connection()
    if category:
        rows = conn.execute(
            """
            SELECT * FROM user_memories
            WHERE tenant_id = ? AND user_id = ? AND category = ?
            ORDER BY updated_at DESC
            """,
            (tenant_id, user_id, category),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT * FROM user_memories
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY updated_at DESC
            """,
            (tenant_id, user_id),
        ).fetchall()
    return db.rows_to_list(rows)


def upsert_user_memory(
    tenant_id: str,
    user_id: str,
    category: str,
    key: str,
    content: str,
    confidence: float = 1.0,
    source: str = "explicit",
) -> str:
    """Inserts or updates an analyst-specific memory item."""
    now = _now()
    memory_id = f"mem-u-{uuid.uuid4().hex[:10]}"
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO user_memories (
                memory_id, tenant_id, user_id, category, key, content,
                confidence, source, access_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(tenant_id, user_id, category, key) DO UPDATE SET
                content = excluded.content,
                confidence = excluded.confidence,
                source = excluded.source,
                updated_at = excluded.updated_at
            """,
            (
                memory_id,
                tenant_id,
                user_id,
                category,
                key,
                content,
                confidence,
                source,
                now,
                now,
            ),
        )
    return memory_id


def delete_user_memory(memory_id: str, tenant_id: str) -> bool:
    """Deletes a user memory item by ID."""
    with db.tx() as conn:
        res = conn.execute(
            "DELETE FROM user_memories WHERE memory_id = ? AND tenant_id = ?",
            (memory_id, tenant_id),
        )
        return res.rowcount > 0


# --------------------------------------------------------------------------
# Tenant Memory CRUD
# --------------------------------------------------------------------------


def get_tenant_memories(
    tenant_id: str,
    category: str | None = None,
) -> list[dict[str, Any]]:
    """Retrieves active organization-wide credit policies & standards."""
    conn = db.get_connection()
    if category:
        rows = conn.execute(
            """
            SELECT * FROM tenant_memories
            WHERE tenant_id = ? AND status = 'active' AND category = ?
            ORDER BY updated_at DESC
            """,
            (tenant_id, category),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT * FROM tenant_memories
            WHERE tenant_id = ? AND status = 'active'
            ORDER BY updated_at DESC
            """,
            (tenant_id,),
        ).fetchall()
    return db.rows_to_list(rows)


def upsert_tenant_memory(
    tenant_id: str,
    category: str,
    title: str,
    content: str,
    status: str = "active",
) -> str:
    """Inserts or updates a firm-wide credit guideline."""
    now = _now()
    memory_id = f"mem-t-{uuid.uuid4().hex[:10]}"
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO tenant_memories (
                memory_id, tenant_id, category, title, content, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, category, title) DO UPDATE SET
                content = excluded.content,
                status = excluded.status,
                updated_at = excluded.updated_at
            """,
            (
                memory_id,
                tenant_id,
                category,
                title,
                content,
                status,
                now,
                now,
            ),
        )
    return memory_id


def delete_tenant_memory(memory_id: str, tenant_id: str) -> bool:
    """Deletes or deactivates a tenant policy memory item."""
    with db.tx() as conn:
        res = conn.execute(
            "DELETE FROM tenant_memories WHERE memory_id = ? AND tenant_id = ?",
            (memory_id, tenant_id),
        )
        return res.rowcount > 0


# --------------------------------------------------------------------------
# Seed Defaults & Formatting for Generation Prompts
# --------------------------------------------------------------------------


def seed_default_memories_if_empty(tenant_id: str = "tenant-a") -> None:
    """Seeds baseline analyst preferences and tenant credit policy memories."""
    conn = db.get_connection()
    count_u = conn.execute(
        "SELECT COUNT(*) AS c FROM user_memories WHERE tenant_id = ?", (tenant_id,)
    ).fetchone()["c"]
    if count_u == 0:
        upsert_user_memory(
            tenant_id=tenant_id,
            user_id="web-ui",
            category="reporting_style",
            key="financial_metrics_format",
            content="Always present covenant ratios (DSCR, LTV, EBITDA) in clean markdown tables with exact period-over-period delta columns.",
        )
        upsert_user_memory(
            tenant_id=tenant_id,
            user_id="web-ui",
            category="risk_tolerance",
            key="covenant_headroom_alert",
            content="Highlight any loan covenant headroom under 15% as an immediate High Severity operational risk.",
        )
        upsert_user_memory(
            tenant_id=tenant_id,
            user_id="web-ui",
            category="sector_focus",
            key="primary_coverage",
            content="Primary coverage focus: Commercial Lending, Enterprise SaaS Contracts, and Syndicated Facilities.",
        )

    count_t = conn.execute(
        "SELECT COUNT(*) AS c FROM tenant_memories WHERE tenant_id = ?", (tenant_id,)
    ).fetchone()["c"]
    if count_t == 0:
        upsert_tenant_memory(
            tenant_id=tenant_id,
            category="credit_policy",
            title="Standard Covenant Thresholds",
            content="Senior Debt / EBITDA must not exceed 3.50x; Minimum Interest Coverage Ratio (EBITDA / Interest Expense) is 3.00x.",
        )
        upsert_tenant_memory(
            tenant_id=tenant_id,
            category="accounting_standards",
            title="EBITDA Normalization Policy",
            content="All comparative metrics must be normalized for one-time restructuring costs and verified on a trailing-twelve-months (TTM) basis.",
        )
        upsert_tenant_memory(
            tenant_id=tenant_id,
            category="compliance_mandate",
            title="Cross-Document Discrepancy Protocol",
            content="When conflicting numbers appear across chronological reports, explicit temporal contradiction resolution must be cited.",
        )


def format_memories_for_prompt(tenant_id: str, user_id: str, query: str = "") -> str:
    """Formats relevant user and tenant memories into an actionable block for LLM prompts."""
    tenant_mems = get_tenant_memories(tenant_id)
    user_mems = get_user_memories(tenant_id, user_id)

    if not tenant_mems and not user_mems:
        return ""

    lines = ["[PERSISTENT ENTERPRISE POLICY & ANALYST PREFERENCE CONTEXT]:"]
    if tenant_mems:
        lines.append("FIRM CREDIT POLICIES & STANDARDS:")
        for tm in tenant_mems[:3]:
            lines.append(f"  - [{tm['category'].upper()}] {tm['title']}: {tm['content']}")

    if user_mems:
        lines.append("ANALYST REPORTING PREFERENCES:")
        for um in user_mems[:3]:
            lines.append(f"  - [{um['category'].upper()}] {um['key']}: {um['content']}")

    lines.append("[END PERSISTENT CONTEXT -- strictly respect these policies and formatting rules in your response]\n")
    return "\n".join(lines)
