"""Decision-Intelligence evaluation API -- feature/decision-intelligence-layer,
Phase B. Net-new router; registered alongside (never replacing) the
existing `/evaluation` router in `main.py`.

    GET  /decision-eval/policy-gold-set     -> the new policy-block gold cases
    POST /decision-eval/run-policy-block    -> policy-block accuracy (net-new metric)
    GET  /decision-eval/latest-policy-block -> most recently persisted policy-block run
    GET  /decision-eval/summary             -> READ-ONLY combined view for the new
                                                dashboard tab: the latest persisted
                                                policy-block run alongside the latest
                                                persisted /evaluation/run-full report
                                                (citation precision, faithfulness,
                                                abstention accuracy, and the new
                                                unsupported_claim_rate field added to
                                                that report in Phase B -- see
                                                evaluation/full_benchmark.py). Never
                                                re-runs the (slow) full benchmark
                                                itself -- that stays an explicit,
                                                opt-in action on the existing
                                                /evaluation page.

Same unauthenticated posture as the existing `/evaluation` router it sits
next to (see that router's own docstring for the reasoning) -- an
internal/system evaluation harness, not an end-user data path.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app import db
from app.evaluation import policy_eval
from app.evaluation.policy_gold_queries import POLICY_GOLD_QUERIES

router = APIRouter(prefix="/decision-eval", tags=["decision-eval"])


@router.get("/policy-gold-set")
def policy_gold_set() -> dict:
    return {"n_cases": len(POLICY_GOLD_QUERIES), "cases": POLICY_GOLD_QUERIES}


class PolicyBlockRunRequest(BaseModel):
    tenant_id: str = "tenant-a"
    top_k: int = 10


@router.post("/run-policy-block")
def run_policy_block(req: PolicyBlockRunRequest) -> dict:
    """Runs the net-new policy-block-accuracy metric over
    `POLICY_GOLD_QUERIES` and persists it (mirrors `/evaluation/run-full`'s
    own persist-then-let-/latest-read-it-back pattern)."""
    report = policy_eval.run_policy_block_eval(tenant_id=req.tenant_id, top_k=req.top_k)

    run_id = f"decision-eval-{uuid.uuid4().hex[:12]}"
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO decision_eval_runs (run_id, kind, n_cases, report_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (run_id, "policy_block", report["n_cases"], db.dumps(report), datetime.now(timezone.utc).isoformat()),
        )
    report["run_id"] = run_id
    return report


@router.get("/latest-policy-block")
def latest_policy_block() -> dict:
    row = db.row_to_dict(
        db.get_connection()
        .execute(
            "SELECT * FROM decision_eval_runs WHERE kind = 'policy_block' ORDER BY created_at DESC LIMIT 1"
        )
        .fetchone()
    )
    if not row:
        return {"available": False, "message": "No /decision-eval/run-policy-block has been recorded yet."}
    report = db.loads(row["report_json"], {})
    report["run_id"] = row["run_id"]
    report["created_at"] = row["created_at"]
    report["available"] = True
    return report


@router.get("/summary")
def summary() -> dict:
    """Read-only aggregation for the new dashboard tab -- reads two
    already-persisted reports, computes nothing itself, and never
    triggers a benchmark run (both underlying runs stay explicit,
    opt-in actions, matching the existing /evaluation page's own
    posture on the slow full benchmark)."""
    conn = db.get_connection()

    full_row = db.row_to_dict(
        conn.execute("SELECT * FROM evaluation_runs ORDER BY created_at DESC LIMIT 1").fetchone()
    )
    quality: dict | None = None
    if full_row:
        report = db.loads(full_row["report_json"], {})
        overall = report.get("overall", {})
        quality = {
            "run_id": full_row["run_id"],
            "created_at": full_row["created_at"],
            "n_queries": report.get("n_queries"),
            "citation_precision": overall.get("mean_citation_precision"),
            "mean_faithfulness": overall.get("mean_faithfulness"),
            "unsupported_claim_rate": overall.get("unsupported_claim_rate"),
            "abstention_accuracy": overall.get("abstention_accuracy"),
        }

    policy_row = db.row_to_dict(
        conn.execute(
            "SELECT * FROM decision_eval_runs WHERE kind = 'policy_block' ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    )
    policy: dict | None = None
    if policy_row:
        report = db.loads(policy_row["report_json"], {})
        policy = {
            "run_id": policy_row["run_id"],
            "created_at": policy_row["created_at"],
            "n_cases": report.get("n_cases"),
            "policy_block_accuracy": report.get("policy_block_accuracy"),
            "false_allow_count": report.get("false_allow_count"),
            "false_block_count": report.get("false_block_count"),
        }

    return {
        "quality": quality,
        "quality_available": quality is not None,
        "policy": policy,
        "policy_available": policy is not None,
        "caveat": (
            "Read-only snapshot of the two most recently persisted runs -- run "
            "POST /evaluation/run-full and POST /decision-eval/run-policy-block to refresh either."
        ),
    }
