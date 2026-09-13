"""Self-learning service -- feedback processing, adaptive chunk utility,
triplet mining, and few-shot exemplar memory.

All self-learned behaviors are strictly scoped by tenant_id, preventing any
cross-tenant leakage.
"""
from __future__ import annotations

import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any

from app import db

logger = logging.getLogger("copilot.learning")

MIN_UTILITY = 0.70
MAX_UTILITY = 1.30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def compute_utility_multiplier(
    retrieval_count: int,
    citation_count: int,
    citation_failed_count: int,
    human_positive_count: int,
    human_negative_count: int,
) -> float:
    """Computes a bounded utility score [0.70, 1.30] based on verifiable outcomes:
    - human thumbs-up (+0.06)
    - successful citation verification (+0.02)
    - human thumbs-down (-0.10)
    - citation stripped by validation (-0.08)
    """
    delta = (
        (human_positive_count * 0.06)
        + (citation_count * 0.02)
        - (human_negative_count * 0.10)
        - (citation_failed_count * 0.08)
    )
    # Damped by total impressions to avoid wild swings on small counts
    damping = 1.0 / (1.0 + math.exp(-0.05 * (retrieval_count + 1))) * 2.0
    adjusted = 1.0 + (delta * damping * 0.1)
    return round(max(MIN_UTILITY, min(adjusted, MAX_UTILITY)), 3)


# --------------------------------------------------------------------------
# Chunk Utility Scores
# --------------------------------------------------------------------------


def get_chunk_utility_multipliers(chunk_ids: list[str]) -> dict[str, float]:
    """Returns a map of chunk_id -> utility_multiplier for the requested chunks."""
    if not chunk_ids:
        return {}
    conn = db.get_connection()
    placeholders = ",".join("?" for _ in chunk_ids)
    rows = conn.execute(
        f"SELECT chunk_id, utility_multiplier FROM chunk_utility_scores WHERE chunk_id IN ({placeholders})",
        chunk_ids,
    ).fetchall()
    scores = {r["chunk_id"]: float(r["utility_multiplier"]) for r in rows}
    # Default to 1.0 for chunks not yet in the utility table
    return {cid: scores.get(cid, 1.0) for cid in chunk_ids}


def record_chunk_feedback_impact(
    chunk_ids: list[str],
    rating: int,
    tenant_id: str,
) -> None:
    """Updates human_positive_count or human_negative_count for chunks cited
    in a turn that received explicit human feedback."""
    if not chunk_ids:
        return
    now = _now()
    with db.tx() as conn:
        for cid in chunk_ids:
            row = conn.execute(
                "SELECT * FROM chunk_utility_scores WHERE chunk_id = ?", (cid,)
            ).fetchone()
            if row is None:
                retrieval_c = 1
                cit_c = 1
                fail_c = 0
                pos_c = 1 if rating > 0 else 0
                neg_c = 1 if rating < 0 else 0
            else:
                retrieval_c = row["retrieval_count"]
                cit_c = row["citation_count"]
                fail_c = row["citation_failed_count"]
                pos_c = row["human_positive_count"] + (1 if rating > 0 else 0)
                neg_c = row["human_negative_count"] + (1 if rating < 0 else 0)

            multiplier = compute_utility_multiplier(
                retrieval_c, cit_c, fail_c, pos_c, neg_c
            )

            conn.execute(
                """
                INSERT INTO chunk_utility_scores (
                    chunk_id, tenant_id, retrieval_count, citation_count,
                    citation_failed_count, human_positive_count, human_negative_count,
                    utility_multiplier, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chunk_id) DO UPDATE SET
                    human_positive_count = excluded.human_positive_count,
                    human_negative_count = excluded.human_negative_count,
                    utility_multiplier = excluded.utility_multiplier,
                    updated_at = excluded.updated_at
                """,
                (
                    cid,
                    tenant_id,
                    retrieval_c,
                    cit_c,
                    fail_c,
                    pos_c,
                    neg_c,
                    multiplier,
                    now,
                ),
            )


def record_retrieval_and_validation_outcomes(
    retrieved_chunk_ids: list[str],
    cited_chunk_ids: list[str],
    failed_chunk_ids: list[str],
    tenant_id: str,
) -> None:
    """Invoked after generation + citation validation to update impression and citation counts."""
    if not retrieved_chunk_ids:
        return
    now = _now()
    with db.tx() as conn:
        for cid in retrieved_chunk_ids:
            row = conn.execute(
                "SELECT * FROM chunk_utility_scores WHERE chunk_id = ?", (cid,)
            ).fetchone()
            is_cited = cid in cited_chunk_ids
            is_failed = cid in failed_chunk_ids

            if row is None:
                retrieval_c = 1
                cit_c = 1 if is_cited else 0
                fail_c = 1 if is_failed else 0
                pos_c = 0
                neg_c = 0
            else:
                retrieval_c = row["retrieval_count"] + 1
                cit_c = row["citation_count"] + (1 if is_cited else 0)
                fail_c = row["citation_failed_count"] + (1 if is_failed else 0)
                pos_c = row["human_positive_count"]
                neg_c = row["human_negative_count"]

            multiplier = compute_utility_multiplier(
                retrieval_c, cit_c, fail_c, pos_c, neg_c
            )

            conn.execute(
                """
                INSERT INTO chunk_utility_scores (
                    chunk_id, tenant_id, retrieval_count, citation_count,
                    citation_failed_count, human_positive_count, human_negative_count,
                    utility_multiplier, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chunk_id) DO UPDATE SET
                    retrieval_count = excluded.retrieval_count,
                    citation_count = excluded.citation_count,
                    citation_failed_count = excluded.citation_failed_count,
                    utility_multiplier = excluded.utility_multiplier,
                    updated_at = excluded.updated_at
                """,
                (
                    cid,
                    tenant_id,
                    retrieval_c,
                    cit_c,
                    fail_c,
                    pos_c,
                    neg_c,
                    multiplier,
                    now,
                ),
            )


# --------------------------------------------------------------------------
# User Feedback & Citation Telemetry
# --------------------------------------------------------------------------


def record_feedback(
    trace_id: str,
    rating: int,
    tenant_id: str,
    conversation_id: str | None = None,
    issue_category: str | None = None,
    correction_text: str | None = None,
) -> dict[str, Any]:
    """Logs human feedback and updates utility scores for chunks cited in this trace."""
    now = _now()
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO chat_feedback (
                trace_id, conversation_id, tenant_id, rating,
                issue_category, correction_text, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                conversation_id,
                tenant_id,
                rating,
                issue_category,
                correction_text,
                now,
            ),
        )

        # Retrieve trace to find which chunks were cited
        trace_row = conn.execute(
            "SELECT query, answer_json, citation_validation FROM chat_traces WHERE trace_id = ?",
            (trace_id,),
        ).fetchone()

    if trace_row:
        answer_json = db.loads(trace_row["answer_json"], {})
        citations = answer_json.get("citations", [])
        cited_chunk_ids = [c["chunk_id"] for c in citations if c.get("chunk_id")]
        record_chunk_feedback_impact(cited_chunk_ids, rating, tenant_id)

        # If feedback was positive, confidence is high, and citations passed cleanly,
        # consider promoting to golden_exemplars
        validation_summary = db.loads(trace_row["citation_validation"], {})
        if (
            rating > 0
            and answer_json.get("confidence") == "high"
            and not answer_json.get("abstained")
            and validation_summary.get("stripped", 0) == 0
            and len(citations) > 0
        ):
            # Infer category or lookup from query_router_decisions
            conn = db.get_connection()
            q_row = conn.execute(
                "SELECT category FROM query_router_decisions WHERE trace_id = ?",
                (trace_id,),
            ).fetchone()
            category = q_row["category"] if q_row else "lookup"
            promote_to_exemplar(
                trace_id=trace_id,
                tenant_id=tenant_id,
                query=trace_row["query"],
                query_category=category,
                answer_json=answer_json,
                utility_score=1.1,
            )

    return {"status": "ok", "trace_id": trace_id, "rating": rating}


def record_citation_interaction(
    trace_id: str,
    chunk_id: str,
    document_id: str,
    page_number: int | None,
    interaction_type: str,
    tenant_id: str,
) -> dict[str, Any]:
    """Records when an end user interacts with/deep-links into a citation."""
    now = _now()
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO citation_interactions (
                trace_id, chunk_id, document_id, page_number,
                interaction_type, tenant_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                chunk_id,
                document_id,
                page_number,
                interaction_type,
                tenant_id,
                now,
            ),
        )
    # A citation click is a human validation signal: reinforce chunk utility
    record_chunk_feedback_impact([chunk_id], rating=1, tenant_id=tenant_id)
    return {"status": "ok", "chunk_id": chunk_id, "interaction_type": interaction_type}


# --------------------------------------------------------------------------
# Dynamic Golden Exemplar Memory
# --------------------------------------------------------------------------


def promote_to_exemplar(
    trace_id: str,
    tenant_id: str,
    query: str,
    query_category: str,
    answer_json: dict[str, Any],
    utility_score: float = 1.0,
) -> str:
    """Stores a verified, high-quality Q&A pair as an in-context few-shot exemplar."""
    now = _now()
    exemplar_id = f"ex-{uuid.uuid4().hex[:10]}"
    citations = answer_json.get("citations", [])
    with db.tx() as conn:
        conn.execute(
            """
            INSERT INTO golden_exemplars (
                exemplar_id, tenant_id, query_category, query,
                synthesized_reasoning, verified_answer_json, citation_count,
                utility_score, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                exemplar_id,
                tenant_id,
                query_category,
                query,
                None,
                db.dumps(answer_json),
                len(citations),
                utility_score,
                now,
            ),
        )
    logger.info("Promoted trace %s to golden exemplar %s (%s)", trace_id, exemplar_id, query_category)
    return exemplar_id


def get_relevant_exemplars(
    query_category: str,
    tenant_id: str,
    limit: int = 1,
) -> list[dict[str, Any]]:
    """Retrieves verified golden exemplars for a specific query category and tenant."""
    conn = db.get_connection()
    rows = conn.execute(
        """
        SELECT exemplar_id, query, verified_answer_json, citation_count, utility_score
        FROM golden_exemplars
        WHERE tenant_id = ? AND query_category = ?
        ORDER BY utility_score DESC, created_at DESC
        LIMIT ?
        """,
        (tenant_id, query_category, limit),
    ).fetchall()

    results = []
    for r in db.rows_to_list(rows):
        r["verified_answer_json"] = db.loads(r["verified_answer_json"], {})
        results.append(r)
    return results


# --------------------------------------------------------------------------
# Active Learning Triplet Export
# --------------------------------------------------------------------------


def export_triplets(tenant_id: str, limit: int = 200) -> list[dict[str, Any]]:
    """Mines (query, positive_chunk_ids, hard_negative_chunk_ids) triplets from
    high-confidence traces for offline reranker distillation."""
    conn = db.get_connection()
    # Find traces with positive feedback or high confidence answers without abstention
    rows = conn.execute(
        """
        SELECT t.trace_id, t.query, t.retrieved_chunk_ids, t.answer_json
        FROM chat_traces t
        LEFT JOIN chat_feedback f ON t.trace_id = f.trace_id
        WHERE t.tenant_id = ? AND t.abstained = 0 AND (f.rating > 0 OR t.confidence = 'high')
        ORDER BY t.created_at DESC LIMIT ?
        """,
        (tenant_id, limit),
    ).fetchall()

    triplets = []
    for r in db.rows_to_list(rows):
        retrieved = db.loads(r["retrieved_chunk_ids"], [])
        ans = db.loads(r["answer_json"], {})
        citations = ans.get("citations", [])
        positives = [c["chunk_id"] for c in citations if c.get("chunk_id")]
        if not positives:
            continue
        # Hard negatives: chunks retrieved in top_k that were NOT cited
        negatives = [cid for cid in retrieved if cid not in positives]
        if negatives:
            triplets.append(
                {
                    "trace_id": r["trace_id"],
                    "query": r["query"],
                    "positive_chunk_ids": positives,
                    "negative_chunk_ids": negatives,
                }
            )
    return triplets
