"""Phase 3 exit-criteria tests, run against the three sample call reports
(see conftest.py) through the real ingestion + retrieval pipeline.
"""
from __future__ import annotations

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))

from app import db  # noqa: E402
from app.services import search_index  # noqa: E402


# --------------------------------------------------------------------------
# Chunking
# --------------------------------------------------------------------------


def test_chunks_created_with_sane_token_sizes(ingested):
    conn = db.get_connection()
    rows = db.rows_to_list(conn.execute("SELECT * FROM chunks").fetchall())
    assert len(rows) > 0, "expected chunks to be created for all three documents"

    doc_ids = set(ingested["doc_ids"].values())
    assert {r["document_id"] for r in rows} <= doc_ids

    passage_rows = [r for r in rows if r["chunk_type"] == "passage"]
    assert passage_rows, "expected at least one passage chunk"
    for r in passage_rows:
        # Short synthetic sample docs mean some passages land under the
        # 200-token soft minimum -- but never over the 600-token hard max,
        # and every chunk must carry the contextualized content used for
        # embedding + BM25.
        assert r["token_count"] <= 600
        assert r["content"]
        assert "Document:" in r["content"]


def test_chunks_respect_section_boundaries(ingested):
    """No passage should span two different section_paths."""
    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute("SELECT chunk_id, parent_section_id, section_path FROM chunks WHERE chunk_type = 'passage'").fetchall()
    )
    sections_by_id: dict[str, set] = {}
    for r in rows:
        sections_by_id.setdefault(r["parent_section_id"], set()).add(r["section_path"])
    for section_id, paths in sections_by_id.items():
        assert len(paths) == 1, f"section {section_id} spans multiple section_paths: {paths}"


def test_tables_chunked_separately_from_prose(ingested):
    conn = db.get_connection()
    rows = db.rows_to_list(conn.execute("SELECT * FROM chunks WHERE chunk_type = 'table'").fetchall())
    assert len(rows) >= 3, "expected at least one table chunk per sample document"
    for r in rows:
        table_json = db.loads(r["table_json"])
        assert table_json is not None
        assert table_json.get("headers")
        assert table_json.get("rows")
        # A table chunk's raw_text should be the table's own markdown, not
        # narrative prose merged in from a surrounding paragraph.
        assert "|" in r["raw_text"]


def test_deterministic_chunk_ids_on_reprocess(ingested):
    """Reprocessing the same document should produce the same chunk_ids
    (update semantics), not duplicate rows."""
    client = ingested["client"]
    doc_id = ingested["doc_ids"]["contoso_original"]

    conn = db.get_connection()
    before = {
        r["chunk_id"]
        for r in db.rows_to_list(conn.execute("SELECT chunk_id FROM chunks WHERE document_id = ?", (doc_id,)).fetchall())
    }

    resp = client.post(f"/documents/{doc_id}/reprocess?force=true")
    assert resp.status_code == 200

    import time

    deadline = time.time() + 60
    while time.time() < deadline:
        status = client.get(f"/documents/{doc_id}").json()["latest"]["status"]
        if status == "completed":
            break
        time.sleep(1)
    assert status == "completed"

    after = {
        r["chunk_id"]
        for r in db.rows_to_list(conn.execute("SELECT chunk_id FROM chunks WHERE document_id = ?", (doc_id,)).fetchall())
    }
    assert before == after, "reprocessing changed chunk_ids instead of updating in place"


# --------------------------------------------------------------------------
# Embeddings
# --------------------------------------------------------------------------


def test_every_chunk_has_an_embedding_model_recorded(ingested):
    conn = db.get_connection()
    rows = db.rows_to_list(conn.execute("SELECT chunk_id, embedding_model FROM chunks").fetchall())
    assert rows
    assert all(r["embedding_model"] for r in rows), "every chunk should record which embedding model indexed it"


def test_every_chunk_is_present_in_the_vector_index(ingested):
    conn = db.get_connection()
    chunk_ids = {r["chunk_id"] for r in db.rows_to_list(conn.execute("SELECT chunk_id FROM chunks").fetchall())}
    mgr = search_index.get_index_manager()
    indexed_ids = set(mgr._id_map["chunk_to_label"].keys())
    assert chunk_ids <= indexed_ids


# --------------------------------------------------------------------------
# BM25 / vector / RRF / reranking, standalone
# --------------------------------------------------------------------------


def test_bm25_search_returns_sane_results(ingested):
    hits = search_index.lexical_search("Acme Corp competitor", k=10)
    assert hits, "BM25 should find the lexical match on 'Acme Corp'"
    doc_ids = {c for c, _ in hits}
    conn = db.get_connection()
    rows = db.rows_to_list(conn.execute("SELECT chunk_id, document_id FROM chunks").fetchall())
    doc_id_by_chunk = {r["chunk_id"]: r["document_id"] for r in rows}
    matched_docs = {doc_id_by_chunk[c] for c in doc_ids if c in doc_id_by_chunk}
    assert ingested["doc_ids"]["contoso_original"] in matched_docs
    assert ingested["doc_ids"]["globex"] in matched_docs


def test_vector_search_returns_sane_results(ingested):
    mgr = search_index.get_index_manager()
    hits = mgr.search("pricing proposal accepted by the customer", k=10)
    assert hits, "vector search should return candidates"
    assert all(isinstance(c, str) and isinstance(s, float) for c, s in hits)


def test_rrf_combines_bm25_and_vector_signal():
    """A synthetic case where BM25-only and vector-only would each miss a
    result that RRF's combination catches."""
    bm25_only = ["a", "b", "c"]
    vector_only = ["d", "e", "f"]
    fused = search_index.reciprocal_rank_fusion([bm25_only, vector_only])
    fused_ids = [c for c, _ in fused]
    # Every candidate from either list appears in the fused ranking, even
    # ones that ranked #1 in only one list -- neither pure list alone
    # contains all six.
    assert set(fused_ids) == {"a", "b", "c", "d", "e", "f"}
    assert "a" not in vector_only and "a" in fused_ids
    assert "d" not in bm25_only and "d" in fused_ids
    # Top of the fused list should be the items that ranked #1 in each
    # source list (tied RRF score), ahead of items ranked lower in both.
    assert set(fused_ids[:2]) == {"a", "d"}


def test_reranking_reorders_the_rrf_output(ingested):
    query = "Contoso pricing proposal status"
    candidates = [
        {"chunk_id": "x", "content": "The weather in the Pacific Northwest is often rainy in autumn."},
        {"chunk_id": "y", "content": "The Contoso pricing proposal status is now Completed and accepted."},
    ]
    # RRF order deliberately puts the irrelevant chunk first to prove
    # reranking actually changes the order, not just re-scores in place.
    reranked = search_index.rerank(query, list(candidates))
    assert reranked[0]["chunk_id"] == "y", "reranker should promote the on-topic chunk to #1"
    assert reranked[0]["rerank_score"] > reranked[1]["rerank_score"]


# --------------------------------------------------------------------------
# End-to-end /search and /retrieval against the sample PDFs (spec Section 8)
# --------------------------------------------------------------------------


def test_search_risks_for_contoso_scoped_correctly(ingested):
    client = ingested["client"]
    resp = client.post("/search", json={"query": "What risks were raised for Contoso?", "top_k": 8})
    assert resp.status_code == 200
    data = resp.json()
    assert data["results"], "expected results for a risks question"
    top_doc_ids = {r["document_id"] for r in data["results"][:3]}
    assert ingested["doc_ids"]["contoso_original"] in top_doc_ids or ingested["doc_ids"]["contoso_followup"] in top_doc_ids
    assert ingested["doc_ids"]["globex"] not in {r["document_id"] for r in data["results"][:2]}


def test_search_pricing_status_prefers_the_followup(ingested):
    client = ingested["client"]
    resp = client.post("/search", json={"query": "What is the status of the Contoso pricing proposal?", "top_k": 8})
    data = resp.json()
    assert data["results"]
    top = data["results"][0]
    assert top["document_id"] == ingested["doc_ids"]["contoso_followup"], (
        "the follow-up report (status: Completed) should rank as most relevant for a "
        "current-status question, even though full temporal reasoning is Phase 5 scope"
    )


def test_search_acme_corp_surfaces_both_customers(ingested):
    client = ingested["client"]
    resp = client.post("/search", json={"query": "Which customers mentioned Acme Corp?", "top_k": 10})
    data = resp.json()
    result_doc_ids = {r["document_id"] for r in data["results"]}
    assert ingested["doc_ids"]["contoso_original"] in result_doc_ids
    assert ingested["doc_ids"]["globex"] in result_doc_ids


def test_search_pipeline_value_hits_table_chunks(ingested):
    client = ingested["client"]
    resp = client.post("/search", json={"query": "What was the pipeline value for Contoso in Q2?", "top_k": 10})
    data = resp.json()
    chunk_types = {r["chunk_type"] for r in data["results"]}
    assert "table" in chunk_types, "a dollar-value/pipeline question should retrieve table chunks"


def test_search_response_includes_citable_source(ingested):
    client = ingested["client"]
    resp = client.post("/search", json={"query": "Contoso risks", "top_k": 5})
    for r in resp.json()["results"]:
        assert r["document_id"]
        assert r["page_number"] is not None


def test_retrieval_endpoint_returns_assembled_context(ingested):
    client = ingested["client"]
    resp = client.post("/retrieval", json={"query": "What risks were raised for Contoso?", "top_k": 6})
    assert resp.status_code == 200
    data = resp.json()
    assert data["evidence_count"] > 0
    assert len(data["trace"]["final_chunk_ids"]) == data["evidence_count"]


def test_search_filters_by_customer(ingested):
    client = ingested["client"]
    resp = client.post(
        "/search", json={"query": "risks", "top_k": 10, "filters": {"customer": "Globex"}}
    )
    data = resp.json()
    assert data["results"]
    assert all(r["customer_name"] == "Globex" for r in data["results"])


def test_diversification_caps_results_per_document(ingested):
    client = ingested["client"]
    resp = client.post(
        "/search",
        json={"query": "pricing risk pipeline action", "top_k": 12, "max_per_document": 2, "max_per_section": 5},
    )
    data = resp.json()
    counts: dict[str, int] = {}
    for r in data["results"]:
        counts[r["document_id"]] = counts.get(r["document_id"], 0) + 1
    assert all(c <= 2 for c in counts.values())


def test_reindex_rebuilds_without_data_loss(ingested):
    client = ingested["client"]
    conn = db.get_connection()
    chunk_count_before = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]

    resp = client.post("/search/reindex")
    assert resp.status_code == 200
    assert resp.json()["reindexed_vectors"] == chunk_count_before

    # chunks (source of truth) untouched by a vector-index rebuild
    chunk_count_after = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    assert chunk_count_after == chunk_count_before

    # search still works post-rebuild
    resp2 = client.post("/search", json={"query": "Contoso risks", "top_k": 5})
    assert resp2.json()["results"]
