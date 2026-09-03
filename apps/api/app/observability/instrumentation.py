"""Observability instrumentation -- write side (Phase C, net-new).

Two independent, additive logging calls, both consumed from
`routers/copilot.py`'s existing `_chat_stream` inside try/except blocks
that can never raise into the existing chat flow (a logging failure must
never turn into a user-facing chat failure):

  record_stage_timings -- per-stage elapsed time for one /chat call
  record_failure       -- a /chat call that raised before completing

See app/db.py for the two new tables these write to
(`chat_trace_stage_timings`, `chat_trace_errors`) -- both new tables, not
new columns on the existing `chat_traces` table.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app import db


def record_stage_timings(
    *,
    trace_id: str,
    conversation_id: str | None,
    tenant_id: str | None,
    timings: list[tuple[str, int]],
) -> None:
    if not timings:
        return
    now = datetime.now(timezone.utc).isoformat()
    with db.tx() as conn:
        conn.executemany(
            "INSERT INTO chat_trace_stage_timings "
            "(trace_id, conversation_id, tenant_id, stage, elapsed_ms, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(trace_id, conversation_id, tenant_id, stage, elapsed_ms, now) for stage, elapsed_ms in timings],
        )


def record_failure(
    *,
    trace_id: str | None,
    conversation_id: str | None,
    tenant_id: str | None,
    stage: str,
    query: str | None,
    error_message: str,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO chat_trace_errors "
            "(trace_id, conversation_id, tenant_id, stage, query, error_message, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (trace_id, conversation_id, tenant_id, stage, query, error_message, now),
        )
