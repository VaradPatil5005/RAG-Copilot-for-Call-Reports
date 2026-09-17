"""Knowledge Curator Service (Phase E Extension).

Runs scheduled and on-demand maintenance over learned knowledge artifacts:
1. Skill Lifecycle Aging: transitions unused skills ('active' -> 'stale' -> 'archived').
2. Exemplar Hygiene: prunes low-utility or obsolete few-shot exemplars (utility < 0.85).
3. Lexicon Consolidation: detects and merges redundant or overlapping learned acronyms.
4. Persistent Audit Trail: writes execution summaries to `curator_audit_log`.

Inactivity-safe: never deletes unrecoverable data, archives gracefully.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app import db

logger = logging.getLogger("copilot.curator")

STALE_AFTER_DAYS = 14
ARCHIVE_AFTER_DAYS = 30
LOW_UTILITY_EXEMPLAR_THRESHOLD = 0.85


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_curator_cycle(tenant_id: str, triggered_by: str = "manual_admin") -> dict[str, Any]:
    """Executes a full curation and lifecycle maintenance cycle for a tenant."""
    t0 = time.perf_counter()
    run_id = f"curate-{uuid.uuid4().hex[:10]}"
    now_dt = datetime.now(timezone.utc)
    stale_cutoff = (now_dt - timedelta(days=STALE_AFTER_DAYS)).isoformat()
    archive_cutoff = (now_dt - timedelta(days=ARCHIVE_AFTER_DAYS)).isoformat()

    conn = db.get_connection()
    actions = {
        "skills_marked_stale": 0,
        "skills_archived": 0,
        "exemplars_pruned": 0,
        "lexicon_terms_consolidated": 0,
    }

    # 1. Skill lifecycle management
    # Active -> Stale (created or last used before stale_cutoff, excluding system skills)
    stale_candidates = conn.execute(
        """
        SELECT skill_id FROM procedural_skills
        WHERE tenant_id = ? AND state = 'active' AND created_by != 'system'
        AND COALESCE(last_used_at, created_at) < ?
        """,
        (tenant_id, stale_cutoff),
    ).fetchall()
    for s in stale_candidates:
        with db.tx() as tx:
            tx.execute(
                "UPDATE procedural_skills SET state = 'stale', updated_at = ? WHERE skill_id = ?",
                (_now(), s["skill_id"]),
            )
            actions["skills_marked_stale"] += 1

    # Stale -> Archived (last used/created before archive_cutoff)
    archive_candidates = conn.execute(
        """
        SELECT skill_id FROM procedural_skills
        WHERE tenant_id = ? AND state = 'stale' AND created_by != 'system'
        AND COALESCE(last_used_at, created_at) < ?
        """,
        (tenant_id, archive_cutoff),
    ).fetchall()
    for s in archive_candidates:
        with db.tx() as tx:
            tx.execute(
                "UPDATE procedural_skills SET state = 'archived', updated_at = ? WHERE skill_id = ?",
                (_now(), s["skill_id"]),
            )
            actions["skills_archived"] += 1

    # 2. Exemplar hygiene (prune exemplars whose utility score dropped below threshold)
    low_exemplars = conn.execute(
        """
        SELECT exemplar_id FROM golden_exemplars
        WHERE tenant_id = ? AND utility_score < ?
        """,
        (tenant_id, LOW_UTILITY_EXEMPLAR_THRESHOLD),
    ).fetchall()
    for ex in low_exemplars:
        with db.tx() as tx:
            tx.execute(
                "DELETE FROM golden_exemplars WHERE exemplar_id = ?",
                (ex["exemplar_id"],),
            )
            actions["exemplars_pruned"] += 1

    # 3. Lexicon consolidation (merge duplicate terms with case variations)
    lexicon_rows = db.rows_to_list(
        conn.execute(
            "SELECT id, term, expansion, frequency, confidence FROM learned_lexicon WHERE tenant_id = ? AND status = 'active'",
            (tenant_id,),
        ).fetchall()
    )
    seen: dict[str, dict] = {}
    to_delete = []
    for row in lexicon_rows:
        canon_key = f"{row['term'].strip().lower()}::{row['expansion'].strip().lower()}"
        if canon_key in seen:
            primary = seen[canon_key]
            # Merge frequency and keep highest confidence
            with db.tx() as tx:
                tx.execute(
                    """
                    UPDATE learned_lexicon
                    SET frequency = frequency + ?, confidence = MAX(confidence, ?), updated_at = ?
                    WHERE id = ?
                    """,
                    (row["frequency"], row["confidence"], _now(), primary["id"]),
                )
            to_delete.append(row["id"])
            actions["lexicon_terms_consolidated"] += 1
        else:
            seen[canon_key] = row

    if to_delete:
        with db.tx() as tx:
            for did in to_delete:
                tx.execute("DELETE FROM learned_lexicon WHERE id = ?", (did,))

    duration_ms = round((time.perf_counter() - t0) * 1000, 2)

    # 4. Record audit log
    with db.tx() as tx:
        tx.execute(
            """
            INSERT INTO curator_audit_log (
                run_id, tenant_id, triggered_by, actions_summary, duration_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                tenant_id,
                triggered_by,
                db.dumps(actions),
                duration_ms,
                _now(),
            ),
        )

    logger.info("Curator run %s completed in %.2f ms: %s", run_id, duration_ms, actions)
    return {
        "run_id": run_id,
        "tenant_id": tenant_id,
        "triggered_by": triggered_by,
        "actions": actions,
        "duration_ms": duration_ms,
        "timestamp": _now(),
    }


def get_curator_status(tenant_id: str) -> dict[str, Any]:
    """Returns the latest curation run status and audit trail."""
    conn = db.get_connection()
    latest_run = conn.execute(
        """
        SELECT * FROM curator_audit_log
        WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1
        """,
        (tenant_id,),
    ).fetchone()

    total_runs = conn.execute(
        "SELECT COUNT(*) AS count FROM curator_audit_log WHERE tenant_id = ?",
        (tenant_id,),
    ).fetchone()["count"]

    recent_runs = db.rows_to_list(
        conn.execute(
            """
            SELECT * FROM curator_audit_log
            WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 5
            """,
            (tenant_id,),
        ).fetchall()
    )
    for r in recent_runs:
        r["actions_summary"] = db.loads(r["actions_summary"], {})

    return {
        "tenant_id": tenant_id,
        "total_runs": total_runs,
        "latest_run": {
            "run_id": latest_run["run_id"],
            "triggered_by": latest_run["triggered_by"],
            "actions": db.loads(latest_run["actions_summary"], {}),
            "duration_ms": latest_run["duration_ms"],
            "created_at": latest_run["created_at"],
        }
        if latest_run
        else None,
        "recent_runs": recent_runs,
    }
