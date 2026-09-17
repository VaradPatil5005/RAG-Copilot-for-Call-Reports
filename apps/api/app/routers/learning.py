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

    # Memories count
    user_mem_count = conn.execute(
        "SELECT COUNT(*) AS count FROM user_memories WHERE tenant_id = ?",
        (tenant_id,),
    ).fetchone()["count"]
    tenant_mem_count = conn.execute(
        "SELECT COUNT(*) AS count FROM tenant_memories WHERE tenant_id = ? AND status = 'active'",
        (tenant_id,),
    ).fetchone()["count"]

    # Skills count
    skill_stats = conn.execute(
        """
        SELECT
            COUNT(*) AS total_skills,
            SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_skills,
            SUM(use_count) AS total_executions
        FROM procedural_skills WHERE tenant_id = ?
        """,
        (tenant_id,),
    ).fetchone()

    # Curator runs count
    curator_runs = conn.execute(
        "SELECT COUNT(*) AS count FROM curator_audit_log WHERE tenant_id = ?",
        (tenant_id,),
    ).fetchone()["count"]

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
        "memories": {
            "user_memories": user_mem_count or 0,
            "tenant_memories": tenant_mem_count or 0,
            "total": (user_mem_count or 0) + (tenant_mem_count or 0),
        },
        "skills": {
            "total_skills": skill_stats["total_skills"] or 0,
            "active_skills": skill_stats["active_skills"] or 0,
            "total_executions": skill_stats["total_executions"] or 0,
        },
        "curator_runs": curator_runs or 0,
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


# --------------------------------------------------------------------------
# Persistent Memory Endpoints (User & Tenant)
# --------------------------------------------------------------------------


class UpsertUserMemoryRequest(BaseModel):
    category: str
    key: str
    content: str
    confidence: float = 1.0


class UpsertTenantMemoryRequest(BaseModel):
    category: str
    title: str
    content: str
    status: str = "active"


@router.get("/memories")
def get_memories(
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Returns persistent memories for the current analyst user and enterprise tenant."""
    from app.services import memory_manager

    memory_manager.seed_default_memories_if_empty(identity.tenant_id)
    user_mems = memory_manager.get_user_memories(identity.tenant_id, user_id=identity.sub)
    tenant_mems = memory_manager.get_tenant_memories(identity.tenant_id)
    return {
        "user_memories": user_mems,
        "tenant_memories": tenant_mems,
        "count": len(user_mems) + len(tenant_mems),
    }


@router.post("/memories/user")
def create_user_memory(
    req: UpsertUserMemoryRequest,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Creates or updates an analyst-specific memory item."""
    from app.services import memory_manager

    mid = memory_manager.upsert_user_memory(
        tenant_id=identity.tenant_id,
        user_id=identity.sub,
        category=req.category,
        key=req.key,
        content=req.content,
        confidence=req.confidence,
    )
    return {"status": "ok", "memory_id": mid}


@router.delete("/memories/user/{memory_id}")
def delete_user_memory(
    memory_id: str,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Deletes an analyst user memory item."""
    from app.services import memory_manager

    deleted = memory_manager.delete_user_memory(memory_id, identity.tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"status": "ok", "deleted": memory_id}


@router.post("/memories/tenant")
def create_tenant_memory(
    req: UpsertTenantMemoryRequest,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Creates or updates a firm-wide credit guideline memory item."""
    from app.services import memory_manager

    mid = memory_manager.upsert_tenant_memory(
        tenant_id=identity.tenant_id,
        category=req.category,
        title=req.title,
        content=req.content,
        status=req.status,
    )
    return {"status": "ok", "memory_id": mid}


@router.delete("/memories/tenant/{memory_id}")
def delete_tenant_memory(
    memory_id: str,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Deletes or deactivates a firm-wide guideline memory item."""
    from app.services import memory_manager

    deleted = memory_manager.delete_tenant_memory(memory_id, identity.tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Tenant memory not found")
    return {"status": "ok", "deleted": memory_id}


# --------------------------------------------------------------------------
# Procedural Financial Skills Endpoints
# --------------------------------------------------------------------------


class UpsertSkillRequest(BaseModel):
    name: str
    description: str
    category: str
    trigger_phrases: list[str]
    procedure_markdown: str
    verification_rule: str | None = None


class UpdateSkillStateRequest(BaseModel):
    state: str  # 'active' | 'stale' | 'archived'


@router.get("/skills")
def get_skills(
    state: str | None = None,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Lists procedural financial skills for the tenant."""
    from app.services import skill_manager

    skill_manager.seed_default_skills_if_empty(identity.tenant_id)
    skills = skill_manager.list_skills(identity.tenant_id, state=state)
    return {"skills": skills, "count": len(skills)}


@router.post("/skills")
def create_skill(
    req: UpsertSkillRequest,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Creates or updates a procedural financial analysis skill."""
    from app.services import skill_manager

    sid = skill_manager.upsert_skill(
        tenant_id=identity.tenant_id,
        name=req.name,
        description=req.description,
        category=req.category,
        trigger_phrases=req.trigger_phrases,
        procedure_markdown=req.procedure_markdown,
        verification_rule=req.verification_rule,
        created_by="analyst_custom",
    )
    return {"status": "ok", "skill_id": sid}


@router.patch("/skills/{skill_id}/state")
def update_skill_state(
    skill_id: str,
    req: UpdateSkillStateRequest,
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Updates skill state ('active', 'stale', 'archived')."""
    from app.services import skill_manager

    updated = skill_manager.update_skill_state(skill_id, req.state, identity.tenant_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"status": "ok", "skill_id": skill_id, "new_state": req.state}


# --------------------------------------------------------------------------
# Knowledge Curator Endpoints
# --------------------------------------------------------------------------


@router.get("/curator/status")
def curator_status(
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Returns knowledge curator lifecycle status and recent audit runs."""
    from app.services import curator

    return curator.get_curator_status(identity.tenant_id)


@router.post("/curator/run")
def run_curator(
    identity: auth.Identity = Depends(auth.require_identity),
) -> dict[str, Any]:
    """Triggers an on-demand knowledge curation and lifecycle maintenance cycle."""
    from app.services import curator

    res = curator.run_curator_cycle(identity.tenant_id, triggered_by="manual_admin")
    return res

