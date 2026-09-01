"""Phase 6.1 tests: GraphRAG entity/relationship extraction, alias
resolution, cross-document graph queries, citation completeness, and ACL
enforcement on graph queries. Reuses the session-scoped `ingested` fixture
(three synthetic Contoso/Globex reports, classification "confidential",
owners alice/carol) -- graph extraction runs automatically as an ingestion
pipeline stage, so by the time `ingested` yields, `graph_edges` is already
populated from the real pipeline, not a test-only shortcut.

This sandbox has no reachable hosted/local LLM (see ADR 0005), so
extraction here runs on `RuleBasedEdgeExtractor` -- tests assert against
what that path can actually produce (competitor mentions + risk/commitment
keyword sentences from prose, deterministic Owner/Action table parsing,
deterministic REPORT-DESCRIBES/SUPERSEDES edges), not against LLM-only
capabilities the fallback path doesn't have.
"""
from __future__ import annotations

from app import db
from app.services import graph_extraction, graph_store


# --------------------------------------------------------------------------
# Alias resolution (unit -- no DB needed)
# --------------------------------------------------------------------------


def test_alias_resolution_collapses_known_variants():
    ids = {
        graph_extraction.canonical_id("Competitor", "Acme Corp."),
        graph_extraction.canonical_id("Competitor", "ACME"),
        graph_extraction.canonical_id("Competitor", "Acme Corporation"),
    }
    assert ids == {"competitor:acme"}


def test_normalize_entity_name_strips_legal_suffix():
    assert graph_extraction.normalize_entity_name("Globex Corporation") == "globex"
    assert graph_extraction.normalize_entity_name("Initech LLC") == "initech"


# --------------------------------------------------------------------------
# Entity/relationship extraction (unit -- synthetic chunk dicts)
# --------------------------------------------------------------------------


def test_rule_based_extraction_produces_expected_entities_and_relationships():
    chunk = {
        "chunk_id": "TEST-001:s1:p1",
        "document_id": "TEST-001",
        "version": 1,
        "page_number": 4,
        "customer_name": "Contoso",
        "meeting_date": "2026-05-17",
        "raw_text": "Contoso mentioned they are also evaluating Acme Corp as an alternative vendor. "
        "There is a budget risk since the price increase has not yet been approved. "
        "The team will commit to a revised timeline next week.",
    }
    edges = graph_extraction._rule_based_extract_chunk(chunk)
    predicates = {e.predicate for e in edges}
    assert "MENTIONED_COMPETITOR" in predicates
    assert "HAS_RISK" in predicates
    assert "HAS_COMMITMENT" in predicates
    competitor_edge = next(e for e in edges if e.predicate == "MENTIONED_COMPETITOR")
    assert competitor_edge.subject_type == "Customer"
    assert competitor_edge.subject_name == "Contoso"
    assert competitor_edge.object_type == "Competitor"
    assert competitor_edge.extractor == "rule_based"


def test_deterministic_table_extraction_owns_action():
    chunk = {
        "chunk_id": "TEST-001:p7:t1",
        "document_id": "TEST-001",
        "version": 1,
        "page_number": 7,
        "table_json": {
            "headers": ["Owner", "Action", "Due Date"],
            "rows": [["Alice", "Send revised proposal", "2026-06-01"]],
        },
    }
    edges = graph_extraction._table_extract_actions(chunk)
    assert len(edges) == 1
    edge = edges[0]
    assert edge.predicate == "OWNS"
    assert edge.subject_type == "Person" and edge.subject_name == "Alice"
    assert edge.object_type == "Action" and "revised proposal" in edge.object_name
    assert edge.extractor == "deterministic"
    assert edge.confidence >= 0.9  # structured data -- high confidence


def test_deterministic_report_describes_and_supersedes(ingested):
    # DESCRIBES: exercised against a real ingested document.
    contoso_id = ingested["doc_ids"]["contoso_original"]
    describes = graph_extraction._deterministic_document_edges(contoso_id, 1, "tenant-a")
    assert any(e.predicate == "DESCRIBES" and e.object_name == "Contoso" for e in describes)

    # SUPERSEDES: only fires for version > 1 -- insert a synthetic document
    # row directly to exercise it without a second real upload.
    with db.tx() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO documents (document_id, tenant_id, filename, customer_name, "
            "account_owner, meeting_date, classification, current_version, created_at) "
            "VALUES ('TEST-SUPERSEDES', 'tenant-a', 'x.pdf', 'TestCo', 'alice', '2026-01-01', "
            "'internal', 2, '2026-01-01T00:00:00Z')"
        )
    edges_v2 = graph_extraction._deterministic_document_edges("TEST-SUPERSEDES", 2, "tenant-a")
    assert any(e.predicate == "SUPERSEDES" for e in edges_v2)


# --------------------------------------------------------------------------
# End-to-end: cross-document graph query via the real ingested pipeline
# --------------------------------------------------------------------------


def test_ingestion_populates_graph_edges_for_all_documents(ingested):
    conn = db.get_connection()
    for doc_id in ingested["doc_ids"].values():
        rows = conn.execute(
            "SELECT COUNT(*) AS n FROM graph_edges WHERE source_document_id = ?", (doc_id,)
        ).fetchone()
        assert rows["n"] > 0, f"no graph edges extracted for {doc_id}"


def test_cross_document_graph_query_returns_multiple_customers(ingested):
    client = ingested["client"]
    resp = client.post(
        "/graph/query",
        json={"question": "Which customers mention the same competitor?"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "shared_competitor"
    assert body["edge_count"] > 0

    subject_ids = {e["subject_node_id"] for e in body["edges"]}
    # Contoso (two reports) and Globex both mention "Acme Corp" in the
    # sample corpus -- a correct cross-document answer must include both
    # customers, not just one document's worth of evidence.
    assert "customer:contoso" in subject_ids
    assert "customer:globex" in subject_ids


def test_every_graph_answer_edge_has_a_real_source_citation(ingested):
    """Explicit requirement from the Phase 6 spec: fail if any
    graph-sourced claim lacks a traceable chunk_id/document_id/page."""
    client = ingested["client"]
    resp = client.post("/graph/query", json={"predicate": "MENTIONED_COMPETITOR"})
    body = resp.json()
    assert body["edge_count"] > 0

    conn = db.get_connection()
    for edge in body["edges"]:
        citation = body["citations"].get(edge["edge_id"])
        assert citation is not None, f"edge {edge['edge_id']} has no citation at all"
        assert citation.get("document_id"), f"edge {edge['edge_id']} citation missing document_id"
        assert citation.get("chunk_id"), f"edge {edge['edge_id']} citation missing chunk_id"
        # The cited chunk must actually exist -- a graph answer must never
        # cite a chunk that isn't real retrievable evidence.
        row = conn.execute(
            "SELECT 1 FROM chunks WHERE chunk_id = ?", (citation["chunk_id"],)
        ).fetchone()
        assert row is not None, f"edge {edge['edge_id']} cites a chunk_id that doesn't exist: {citation['chunk_id']}"


# --------------------------------------------------------------------------
# ACL enforcement on graph queries (same posture as passage retrieval)
# --------------------------------------------------------------------------


def test_graph_query_acl_blocks_unauthorized_principal(ingested, mint_token):
    client = ingested["client"]
    resp = client.post(
        "/graph/query",
        json={"predicate": "MENTIONED_COMPETITOR"},
        headers=mint_token("mallory", principals=["tenant:some-other-tenant-that-matches-nothing"]),
    )
    assert resp.status_code == 200
    assert resp.json()["edge_count"] == 0


def test_graph_query_acl_allows_authorized_tenant_principal(ingested, mint_token):
    client = ingested["client"]
    resp = client.post(
        "/graph/query",
        json={"predicate": "MENTIONED_COMPETITOR"},
        headers=mint_token("dave", principals=["tenant:tenant-a"]),
    )
    assert resp.status_code == 200
    assert resp.json()["edge_count"] > 0


def test_graph_query_connected_respects_acl():
    """`query_connected` (multi-hop traversal) must build its in-memory
    graph from the *already-filtered* edge set -- an unauthorized edge
    must never even become a traversal hop."""
    unfiltered = graph_store.query_connected("customer:contoso", tenant_id="tenant-a", principals=None)
    filtered = graph_store.query_connected(
        "customer:contoso",
        tenant_id="tenant-a",
        principals=["tenant:some-other-tenant-that-matches-nothing"],
    )
    assert len(unfiltered.edges) >= len(filtered.edges)
    assert len(filtered.edges) == 0


# --------------------------------------------------------------------------
# Copilot intent routing (Phase 6.1 extends the Phase 4 classifier)
# --------------------------------------------------------------------------


def test_copilot_classifies_cross_document_graph_intent():
    from app.routers import copilot

    assert copilot.classify_intent("Which customers mention the same competitor?") == "cross_document_graph"
    assert copilot.classify_intent("What risks were raised for Contoso?") == "answerable_single_pass"
