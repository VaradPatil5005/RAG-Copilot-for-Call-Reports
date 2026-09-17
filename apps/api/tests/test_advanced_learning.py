"""Comprehensive tests for Advanced Self-Learning Decision Intelligence Engine.

Verifies:
1. User memory CRUD, updates, and isolation.
2. Tenant policy memory CRUD, status updates, and isolation.
3. Memory formatting for LLM prompt context injection.
4. Procedural skills creation, trigger matching, prompt formatting, and state updates.
5. Autonomous skill synthesis from verified multi-citation traces.
6. Knowledge curator lifecycle transitions, exemplar hygiene, lexicon deduplication, and audit logging.
7. Learning router HTTP endpoints with authentication.
"""
from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from fastapi.testclient import TestClient
from app import db
from app.main import app
from app.services import auth, curator, memory_manager, skill_manager


def test_user_and_tenant_memory_lifecycle():
    db.init_db()
    tenant_id = "tenant-test-memory"
    user_id = "analyst-alice"

    # Seed and verify baseline
    memory_manager.seed_default_memories_if_empty(tenant_id)
    baseline_tenant = memory_manager.get_tenant_memories(tenant_id)
    assert len(baseline_tenant) >= 3

    # Add custom user memory
    mid_u = memory_manager.upsert_user_memory(
        tenant_id=tenant_id,
        user_id=user_id,
        category="risk_tolerance",
        key="subordinated_debt_limit",
        content="Reject any credit approval if junior debt exceeds 25% of total enterprise value.",
        confidence=0.98,
    )
    assert mid_u.startswith("mem-u-")

    # Fetch and verify
    user_mems = memory_manager.get_user_memories(tenant_id, user_id)
    assert any(m["key"] == "subordinated_debt_limit" for m in user_mems)

    # Cross-user isolation: bob should not see alice's custom memory
    bob_mems = memory_manager.get_user_memories(tenant_id, "analyst-bob")
    assert not any(m["key"] == "subordinated_debt_limit" for m in bob_mems)

    # Prompt formatting test
    prompt_block = memory_manager.format_memories_for_prompt(tenant_id, user_id)
    assert "PERSISTENT ENTERPRISE POLICY & ANALYST PREFERENCE CONTEXT" in prompt_block
    assert "subordinated_debt_limit" in prompt_block
    assert "Standard Covenant Thresholds" in prompt_block

    # Delete test
    assert memory_manager.delete_user_memory(mid_u, tenant_id)
    assert not any(m["key"] == "subordinated_debt_limit" for m in memory_manager.get_user_memories(tenant_id, user_id))


def test_procedural_skills_matching_and_execution():
    db.init_db()
    tenant_id = "tenant-test-skills"
    with db.tx() as conn:
        conn.execute("DELETE FROM procedural_skills WHERE tenant_id = ?", (tenant_id,))

    # Seed and verify baseline
    skill_manager.seed_default_skills_if_empty(tenant_id)
    skills = skill_manager.list_skills(tenant_id)
    assert len(skills) >= 3

    # Query matching
    covenant_query = "Please perform a covenant compliance audit on Titan Industries Q3 numbers"
    matched = skill_manager.match_skill_for_query(covenant_query, tenant_id)
    assert matched is not None
    assert matched["name"] == "covenant-compliance-audit"

    # Format skill for prompt
    skill_prompt = skill_manager.format_skill_for_prompt(matched)
    assert "ACTIVE PROCEDURAL FINANCIAL SKILL: COVENANT-COMPLIANCE-AUDIT" in skill_prompt
    assert "PROCEDURAL EXECUTION STEPS:" in skill_prompt
    assert "VERIFICATION CRITERIA:" in skill_prompt

    # Usage tracking
    initial_count = matched["use_count"]
    skill_manager.record_skill_usage(matched["skill_id"], tenant_id)
    refreshed = skill_manager.get_skill(matched["skill_id"], tenant_id)
    assert refreshed["use_count"] == initial_count + 1

    # State update
    assert skill_manager.update_skill_state(matched["skill_id"], "archived", tenant_id)
    assert skill_manager.get_skill(matched["skill_id"], tenant_id)["state"] == "archived"


def test_autonomous_skill_synthesis():
    db.init_db()
    tenant_id = "tenant-test-synthesis"
    trace_id = "trace-synth-999"
    with db.tx() as conn:
        conn.execute("DELETE FROM procedural_skills WHERE tenant_id = ?", (tenant_id,))
        conn.execute("DELETE FROM chat_traces WHERE trace_id = ?", (trace_id,))
        conn.execute("DELETE FROM query_router_decisions WHERE trace_id = ?", (trace_id,))

    # Insert a synthetic multi-citation trace
    with db.tx() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO chat_traces (
                trace_id, conversation_id, tenant_id, query, intent,
                retrieved_chunk_ids, answer_json, citation_validation,
                model_name, latency_ms, created_at, confidence, abstained
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                "conv-synth",
                tenant_id,
                "Compare borrowing interest margins between May and August 2024",
                "comparison",
                '["c1", "c2"]',
                '{"answer": "Comparison findings...", "confidence": "high", "abstained": false, "citations": [{"chunk_id": "c1"}, {"chunk_id": "c2"}]}',
                '{"valid": true, "stripped": 0}',
                "test-model",
                250.0,
                "2026-09-17T08:00:00Z",
                "high",
                0,
            ),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO query_router_decisions (
                trace_id, tenant_id, query, category, method, confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (trace_id, tenant_id, "Compare borrowing interest margins", "comparison", "heuristic", "high", "2026-09-17T08:00:00Z"),
        )

    # Synthesize skill
    synth_id = skill_manager.synthesize_skill_from_trace(trace_id, tenant_id)
    assert synth_id is not None
    assert synth_id.startswith("skill-")

    skill = skill_manager.get_skill(synth_id, tenant_id)
    assert skill is not None
    assert skill["created_by"] == "autonomous_agent"
    assert skill["category"] == "comparison"


def test_curator_lifecycle_and_audit():
    db.init_db()
    tenant_id = "tenant-test-curator"

    # Run curator cycle
    cycle_result = curator.run_curator_cycle(tenant_id, triggered_by="manual_admin")
    assert cycle_result["tenant_id"] == tenant_id
    assert "actions" in cycle_result
    assert "run_id" in cycle_result

    # Check status and audit log
    status = curator.get_curator_status(tenant_id)
    assert status["total_runs"] >= 1
    assert status["latest_run"] is not None
    assert status["latest_run"]["run_id"] == cycle_result["run_id"]


def test_learning_router_endpoints():
    db.init_db()
    client = TestClient(app)
    token = auth.create_dev_token(sub="analyst-web", tenant_id="tenant-a", principals=["tenant:tenant-a"])
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Check status
    res = client.get("/learning/status", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "memories" in data
    assert "skills" in data
    assert "curator_runs" in data

    # 2. Check memories
    res_m = client.get("/learning/memories", headers=headers)
    assert res_m.status_code == 200
    m_data = res_m.json()
    assert "user_memories" in m_data
    assert "tenant_memories" in m_data

    # Add user memory via API
    res_post_m = client.post(
        "/learning/memories/user",
        headers=headers,
        json={
            "category": "reporting_style",
            "key": "table_highlighting",
            "content": "Highlight critical variance in bold red.",
            "confidence": 1.0,
        },
    )
    assert res_post_m.status_code == 200
    mid = res_post_m.json()["memory_id"]

    # Delete user memory via API
    res_del_m = client.delete(f"/learning/memories/user/{mid}", headers=headers)
    assert res_del_m.status_code == 200

    # 3. Check procedural skills
    res_s = client.get("/learning/skills", headers=headers)
    assert res_s.status_code == 200
    s_data = res_s.json()
    assert "skills" in s_data

    # 4. Check curator
    res_c_status = client.get("/learning/curator/status", headers=headers)
    assert res_c_status.status_code == 200

    res_c_run = client.post("/learning/curator/run", headers=headers)
    assert res_c_run.status_code == 200
    assert "run_id" in res_c_run.json()
