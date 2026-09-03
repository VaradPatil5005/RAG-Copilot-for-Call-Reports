"""Observability API -- feature/decision-intelligence-layer, Phase C.
Net-new router; registered alongside (never replacing) the existing
`/system` router in `main.py`.

    GET /observability/stage-latency  -> retrieval-stage latency breakdown (new)
    GET /observability/cost-per-query -> per-query cost estimate (new; reuses
                                          system._cost_for_model)
    GET /observability/errors         -> persisted failure/error log (new)
    GET /observability/dashboard      -> all of the above plus the existing
                                          /system/metrics aggregate
                                          (fallback-provider rate, JSON-retry
                                          rate, abstention rate, citation
                                          validation pass rate, latency
                                          percentiles), reused by calling it
                                          directly -- not reimplemented

Same unauthenticated, internal/system-harness posture as the existing
`/system` router it sits next to.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.observability import dashboard

router = APIRouter(prefix="/observability", tags=["observability"])


@router.get("/stage-latency")
def stage_latency(limit: int = 2000) -> dict:
    return dashboard.stage_latency_breakdown(limit=limit)


@router.get("/cost-per-query")
def cost_per_query(limit: int = 50) -> dict:
    return dashboard.cost_per_query(limit=limit)


@router.get("/errors")
def errors(limit: int = 100) -> dict:
    return dashboard.failure_log(limit=limit)


@router.get("/dashboard")
def full_dashboard(stage_limit: int = 2000, cost_limit: int = 50, failure_limit: int = 100, metrics_limit: int = 500) -> dict:
    return dashboard.dashboard(
        stage_limit=stage_limit, cost_limit=cost_limit, failure_limit=failure_limit, metrics_limit=metrics_limit
    )
