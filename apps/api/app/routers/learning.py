"""Learning & Adaptive Intelligence Router (Phase E).

Exposes endpoints to view and manage learned vocabulary, chunk utility scores,
golden exemplars, and human feedback metrics.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import db
from app.services import auth, learning, lexicon_miner

router = APIRouter(prefix="/learning", tags=["learning"])


class UpdateLexiconStatusRequest(BaseModel):
    status: str  # 'active' | 'pending_review' | 'rejected'


@router.get("/status")
def learning_status(identity: auth.Identity = Depends(auth.require_identity)) -> dict[str, Any]:
    """Overview of the self-learning state for the current tenant."""
    conn = db.get_connection()
    tenant_id = identity.tenant_id

    # Feedback counts
    feedback_stats = conn.execute(
        """
        SELECT
            COUNT(*) AS total_feedback,
            SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) AS positive_feedback,
            SUM(CASE WHEN rating < 0 THEN 1 ELSE 0 END) AS negative_feedback
        FROM chat_feedback WHERE tenant_id = ?
        """,
        (tenant_id,),
    ).fetchone()

    # Citation clicks
    click_count = conn.execute(
        "SELECT COUNT(*) AS total_clicks FROM citation_interactions WHERE tenant_id = ?",
        (tenant_id,),
    ).fetchone()

    # Chunk utility stats
    utility_stats = conn.execute(
        """
        SELECT
            COUNT(*) AS total_tracked_chunks,
            AVG(utility_multiplier) AS avg_multiplier,
            SUM(CASE WHEN utility_multiplier > 1.05 THEN 1 ELSE 0 END) AS boosted_chunks,
            SUM(CASE WHEN utility_multiplier < 0.95 THEN 1 ELSE 0 END) AS demoted_chunks
        FROM chunk_utility_scores WHERE tenant_id = ?
        """,
        (tenant_id,),
    ).fetchone()

    # Lexicon stats
    lexicon_stats = conn.execute(
        """
        SELECT
            COUNT(*) AS total_terms,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_terms,
            SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_terms
        FROM learned_lexicon WHERE tenant_id = ?
        """,
        (tenant_id,),
    ).fetchone()

    # Exemplars count
    exemplars_count = conn.execute(
        "SELECT COUNT(*) AS count FROM golden_exemplars WHERE tenant_id = ?",
        (tenant_id,),
    ).fetchone()

    return {
        "tenant_id": tenant_id,
        "feedback": {
            "total": feedback_stats["total_feedback"] or 0,
            "positive": feedback_stats["positive_feedback"] or 0,
            "negative": feedback_stats["negative_feedback"] or 0,
            "citation_clicks": click_count["total_clicks"] or 0,
        },
        "utility": {
            "tracked_chunks": utility_stats["total_tracked_chunks"] or 0,
            "avg_multiplier": round(utility_stats["avg_multiplier"] or 1.0, 3),
            "boosted_chunks": utility_stats["boosted_chunks"] or 0,
            "demoted_chunks": utility_stats["demoted_chunks"] or 0,
        },
        "lexicon": {
            "total_terms": lexicon_stats["total_terms"] or 0,
            "active_terms": lexicon_stats["active_terms"] or 0,
            "pending_terms": lexicon_stats["pending_terms"] or 0,
        },
        "exemplars_count": exemplars_count["count"] or 0,
    }


@router.get("/lexicon")
def get_lexicon(
    status: str | None = None,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Lists discovered terms and acronyms for the tenant."""
    items = lexicon_miner.list_lexicon_items(tenant_id=identity.tenant_id, status=status)
    return {"items": items, "count": len(items)}


@router.patch("/lexicon/{term_id}")
def update_term_status(
    term_id: int,
    req: UpdateLexiconStatusRequest,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Approves or rejects a discovered term."""
    success = lexicon_miner.update_lexicon_status(
        term_id=term_id,
        new_status=req.status,
        tenant_id=identity.tenant_id,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Term not found")
    return {"status": "ok", "term_id": term_id, "new_status": req.status}


@router.get("/exemplars")
def get_exemplars(
    category: str | None = None,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Lists golden exemplars used for dynamic few-shot in-context learning."""
    conn = db.get_connection()
    if category:
        rows = conn.execute(
            "SELECT * FROM golden_exemplars WHERE tenant_id = ? AND query_category = ? ORDER BY utility_score DESC",
            (identity.tenant_id, category),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM golden_exemplars WHERE tenant_id = ? ORDER BY utility_score DESC",
            (identity.tenant_id,),
        ).fetchall()

    out = []
    for r in db.rows_to_list(rows):
        r["verified_answer_json"] = db.loads(r["verified_answer_json"], {})
        out.append(r)
    return {"exemplars": out, "count": len(out)}


@router.get("/utility-scores")
def get_utility_scores(
    limit: int = 50,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Returns chunks with highest and lowest utility scores."""
    conn = db.get_connection()
    rows = conn.execute(
        """
        SELECT * FROM chunk_utility_scores
        WHERE tenant_id = ?
        ORDER BY utility_multiplier DESC
        LIMIT ?
        """,
        (identity.tenant_id, limit),
    ).fetchall()
    return {"scores": db.rows_to_list(rows)}


@router.get("/triplets")
def get_triplets(
    limit: int = 50,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Exports mined training triplets (query, positive chunks, hard negative chunks)."""
    triplets = learning.export_triplets(tenant_id=identity.tenant_id, limit=limit)
    return {"triplets": triplets, "count": len(triplets)}
