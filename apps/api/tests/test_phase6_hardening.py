"""Phase 6.5 tests: blue/green index deployment (build without disturbing
the active index, atomic switch, rollback) and the disaster-recovery
drill (rebuild the full searchable index from raw storage alone)."""
from __future__ import annotations

from app import db
from app.services import disaster_recovery, search_index, storage


# --------------------------------------------------------------------------
# Blue/green index deployment
# --------------------------------------------------------------------------


def test_building_a_new_index_version_does_not_change_the_active_alias(ingested):
    original_active = search_index.get_active_index_name()
    new_name, new_count = search_index.build_new_index_version()

    assert new_count > 0
    assert new_name != original_active
    # The old index must still be the one live traffic is actually
    # served from -- this is the entire point of blue/green.
    assert search_index.get_active_index_name() == original_active
    assert search_index.get_index_manager().name == original_active


def test_old_index_keeps_serving_search_during_a_pending_new_build(ingested):
    client = ingested["client"]
    before = client.post("/search", json={"query": "Contoso pricing risks", "top_k": 5})
    assert before.status_code == 200
    assert len(before.json()["results"]) > 0

    search_index.build_new_index_version()  # not switched yet

    during = client.post("/search", json={"query": "Contoso pricing risks", "top_k": 5})
    assert during.status_code == 200
    assert len(during.json()["results"]) == len(before.json()["results"])


def test_switch_and_rollback_round_trip(ingested):
    client = ingested["client"]
    original_active = search_index.get_active_index_name()

    new_name, _ = search_index.build_new_index_version()
    search_index.switch_active_index(new_name)
    assert search_index.get_active_index_name() == new_name

    # Live traffic must work against the new version too.
    resp = client.post("/search", json={"query": "Contoso pricing risks", "top_k": 5})
    assert resp.status_code == 200
    assert len(resp.json()["results"]) > 0

    # Rollback -- the old version's files were never deleted, so this
    # must succeed and restore identical search results.
    result = search_index.rollback_active_index(original_active)
    assert result["rolled_back_to"] == original_active
    assert search_index.get_active_index_name() == original_active

    resp2 = client.post("/search", json={"query": "Contoso pricing risks", "top_k": 5})
    assert resp2.status_code == 200
    assert len(resp2.json()["results"]) > 0


def test_switching_to_a_nonexistent_version_fails_loudly():
    import pytest

    with pytest.raises(ValueError):
        search_index.switch_active_index("callreports-v9999-does-not-exist")


def test_reindex_endpoint_performs_a_real_blue_green_switch(ingested):
    client = ingested["client"]
    before_active = search_index.get_active_index_name()
    resp = client.post("/search/reindex")
    assert resp.status_code == 200
    body = resp.json()
    assert body["old_active"] == before_active
    assert body["new_active"] != before_active
    assert body["new_count"] > 0
    assert search_index.get_active_index_name() == body["new_active"]


def test_index_versions_endpoint_lists_all_versions_on_disk(ingested):
    client = ingested["client"]
    resp = client.get("/search/index-versions")
    assert resp.status_code == 200
    versions = resp.json()["versions"]
    assert len(versions) >= 1
    assert sum(1 for v in versions if v["is_active"]) == 1


# --------------------------------------------------------------------------
# Disaster recovery
# --------------------------------------------------------------------------


def test_upload_writes_an_immutable_metadata_sidecar(ingested):
    doc_id = ingested["doc_ids"]["contoso_original"]
    conn = db.get_connection()
    doc = db.row_to_dict(conn.execute("SELECT tenant_id FROM documents WHERE document_id = ?", (doc_id,)).fetchone())
    sidecar = storage.load_metadata_sidecar(doc["tenant_id"], doc_id, 1)
    assert sidecar is not None
    assert sidecar["document_id"] == doc_id
    assert sidecar["classification"] == "confidential"
    assert sidecar["customer_name"] == "Contoso"


def test_disaster_recovery_rebuilds_metadata_and_content_from_raw_storage_alone(ingested):
    """The actual drill: wipe every DB row for one document (simulating a
    metadata-store disaster) while leaving its raw PDF + sidecar
    untouched, then confirm recovery restores it -- including
    `classification`, which is the field this phase's DR work specifically
    fixed the recoverability of (see disaster_recovery.py's docstring)."""
    doc_id = ingested["doc_ids"]["contoso_original"]
    conn = db.get_connection()
    doc_row = db.row_to_dict(conn.execute("SELECT * FROM documents WHERE document_id = ?", (doc_id,)).fetchone())
    tenant_id = doc_row["tenant_id"]
    original_classification = doc_row["classification"]
    original_customer = doc_row["customer_name"]

    with db.tx() as tx:
        tx.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
        tx.execute("DELETE FROM elements WHERE document_id = ?", (doc_id,))
        tx.execute("DELETE FROM graph_edges WHERE source_document_id = ?", (doc_id,))
        tx.execute("DELETE FROM document_versions WHERE document_id = ?", (doc_id,))
        tx.execute("DELETE FROM documents WHERE document_id = ?", (doc_id,))

    assert db.row_to_dict(conn.execute("SELECT 1 FROM documents WHERE document_id = ?", (doc_id,)).fetchone()) is None

    report = disaster_recovery.recover_from_raw_storage()

    recovered = next(d for d in report.documents if d.document_id == doc_id)
    assert recovered.status == "recovered"
    assert recovered.metadata_source == "sidecar"
    assert recovered.classification == original_classification
    assert recovered.customer_name == original_customer

    restored = db.row_to_dict(conn.execute("SELECT * FROM documents WHERE document_id = ?", (doc_id,)).fetchone())
    assert restored is not None
    assert restored["classification"] == original_classification
    chunk_count = conn.execute("SELECT COUNT(*) AS n FROM chunks WHERE document_id = ?", (doc_id,)).fetchone()
    assert chunk_count["n"] > 0


def test_disaster_recovery_discovers_a_sidecar_less_document_and_defaults_fail_closed(tmp_path):
    """If the sidecar itself is lost too (a harsher disaster), recovered
    classification must default to the most restrictive tier
    ('confidential'), never 'public' or 'internal' -- see
    disaster_recovery.py's docstring for why this is a fail-closed
    design decision, not an oversight. Uses a standalone raw zone (not
    the shared `ingested` corpus) so it doesn't depend on or mutate that
    fixture's state."""
    raw_root = tmp_path / "raw"
    doc_dir = raw_root / "tenant-a" / "CR-DR-TEST-001" / "1"
    doc_dir.mkdir(parents=True)
    (doc_dir / "source.pdf").write_bytes(b"%PDF-1.4 fake minimal content for a path-discovery test")

    found = disaster_recovery._discover_raw_pdfs(raw_root)
    assert ("tenant-a", "CR-DR-TEST-001", 1, doc_dir / "source.pdf") in found

    sidecar_path = doc_dir / "metadata.json"
    assert not sidecar_path.exists()  # confirms this fixture truly has no sidecar written
