"""Phase 6.3 tests: real server-side auth (no client-supplied
principals/tenant_id), SQL-level ACL pre-filtering (not Python post-fetch),
cross-tenant leakage, forged-token rejection, GraphRAG/multimodal
regression under the new auth model, and the structured audit trail.
"""
from __future__ import annotations

import time

import pytest

from app import db
from app.services import auth, search_index


# --------------------------------------------------------------------------
# Auth: token issuance, verification, and rejection of missing/forged tokens
# --------------------------------------------------------------------------


def test_dev_token_issuance_and_whoami(ingested):
    client = ingested["client"]
    resp = client.post(
        "/auth/dev-token",
        json={"sub": "erin", "tenant_id": "tenant-a", "principals": ["owner:erin"]},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]

    who = client.get("/auth/whoami", headers={"Authorization": f"Bearer {token}"})
    assert who.status_code == 200
    body = who.json()
    assert body["sub"] == "erin"
    assert body["tenant_id"] == "tenant-a"
    assert body["principals"] == ["owner:erin"]


def test_missing_bearer_token_is_rejected(ingested):
    """Every protected endpoint must resolve an identity server-side --
    no Authorization header at all is a 401, not a fall-through to
    unscoped access."""
    client = ingested["client"]
    resp = client.post(
        "/search",
        json={"query": "Contoso pricing"},
        headers={"Authorization": ""},  # explicitly blank -- overrides client default
    )
    assert resp.status_code == 401


def test_forged_tampered_token_is_rejected(ingested, mint_token):
    """A client-supplied principal can no longer be forged in the request
    body (that field doesn't exist anymore) -- the remaining attack
    surface is tampering with a token's payload/signature. Confirm that's
    rejected too, structurally, not by convention."""
    client = ingested["client"]
    good_headers = mint_token("mallory", principals=["tenant:tenant-a"])
    token = good_headers["Authorization"].split(" ", 1)[1]

    # Flip a character in the signature segment.
    header_b64, payload_b64, sig_b64 = token.split(".")
    tampered_sig = ("a" if sig_b64[0] != "a" else "b") + sig_b64[1:]
    forged = f"{header_b64}.{payload_b64}.{tampered_sig}"

    resp = client.post(
        "/search", json={"query": "Contoso pricing"}, headers={"Authorization": f"Bearer {forged}"}
    )
    assert resp.status_code == 401


def test_expired_token_is_rejected(ingested):
    client = ingested["client"]
    expired = auth.create_dev_token("erin", "tenant-a", ["tenant:tenant-a"], ttl_seconds=-10)
    resp = client.post(
        "/search", json={"query": "Contoso pricing"}, headers={"Authorization": f"Bearer {expired}"}
    )
    assert resp.status_code == 401


def test_dev_token_endpoint_disabled_when_auth_dev_mode_off(ingested, monkeypatch):
    from app import config
    from app.routers import auth as auth_router

    monkeypatch.setattr(config, "AUTH_DEV_MODE", False)
    monkeypatch.setattr(auth_router.config, "AUTH_DEV_MODE", False)
    client = ingested["client"]
    resp = client.post("/auth/dev-token", json={"sub": "x", "tenant_id": "tenant-a", "principals": []})
    assert resp.status_code == 404


# --------------------------------------------------------------------------
# ACL enforcement is a real SQL predicate, verified below the HTTP layer
# --------------------------------------------------------------------------


def test_lexical_search_excludes_unauthorized_chunks_at_the_sql_level(ingested):
    """Calls search_index.lexical_search directly (below the router) to
    confirm an unauthorized chunk_id is absent from its raw return value
    -- i.e. the SQL query itself excludes it, this isn't a Python filter
    applied afterward by some other layer."""
    unscoped = search_index.lexical_search("Contoso pricing", k=20, tenant_id="tenant-a", principals=None)
    assert len(unscoped) > 0

    unauthorized = search_index.lexical_search(
        "Contoso pricing", k=20, tenant_id="tenant-a", principals=["tenant:nobody"]
    )
    assert unauthorized == []

    authorized = search_index.lexical_search(
        "Contoso pricing", k=20, tenant_id="tenant-a", principals=["owner:alice"]
    )
    assert len(authorized) > 0
    assert len(authorized) <= len(unscoped)


def test_vector_search_excludes_unauthorized_chunks(ingested):
    mgr = search_index.get_index_manager()
    unscoped = mgr.search("Contoso pricing proposal", k=20, tenant_id="tenant-a", principals=None)
    assert len(unscoped) > 0

    unauthorized = mgr.search("Contoso pricing proposal", k=20, tenant_id="tenant-a", principals=["tenant:nobody"])
    assert unauthorized == []


def test_acl_predicate_sql_is_a_real_where_clause():
    """Unit-level confirmation that `db.acl_predicate_sql` builds a real
    SQL predicate (not a Python-side placeholder) -- exercised against a
    scratch table so the assertion doesn't depend on the ingested corpus."""
    import sqlite3

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE t (id INTEGER, acl_principals TEXT, classification TEXT)")
    conn.execute("INSERT INTO t VALUES (1, ?, ?)", (db.dumps(["tenant:a", "owner:alice"]), "confidential"))
    conn.execute("INSERT INTO t VALUES (2, ?, ?)", (db.dumps(["tenant:b"]), "confidential"))
    conn.execute("INSERT INTO t VALUES (3, ?, ?)", (db.dumps([]), "public"))

    predicate, params = db.acl_predicate_sql(["tenant:a"])
    rows = conn.execute(f"SELECT id FROM t WHERE {predicate}", params).fetchall()
    ids = {r["id"] for r in rows}
    assert ids == {1, 3}  # matches tenant:a's own row, plus the public row -- never tenant:b's


# --------------------------------------------------------------------------
# Cross-tenant leakage: two tenants, overlapping-sounding content, zero
# leakage in both directions.
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def cross_tenant_docs(ingested):
    """Uploads one document under tenant-b (a customer named "Contoso" too,
    deliberately overlapping the tenant-a corpus's most common search
    term) using a tenant-b-scoped token, so the corpus now spans two
    tenants with similar-sounding content."""
    client = ingested["client"]
    b_headers = _mint(tenant_id="tenant-b", sub="frank", principals=["tenant:tenant-b"])

    import io

    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter)
    styles = getSampleStyleSheet()
    doc.build(
        [
            Paragraph("Call Report -- Contoso (Tenant B) -- 2026-07-15", styles["Heading1"]),
            Paragraph(
                "Contoso discussed pricing risks and a competitive threat from Acme Corp in this "
                "tenant-b-only report, which must never be visible to tenant-a callers.",
                styles["Normal"],
            ),
        ]
    )
    buf.seek(0)

    resp = client.post(
        "/documents/upload",
        files={"files": ("tenant-b-contoso.pdf", buf, "application/pdf")},
        data={"customer_name": "Contoso", "account_owner": "frank", "classification": "confidential"},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    document_id = resp.json()["results"][0]["document_id"]

    deadline = time.time() + 60
    terminal = {"completed", "failed", "dead_lettered", "quarantined"}
    status = None
    while time.time() < deadline:
        r = client.get(f"/documents/{document_id}", headers=b_headers)
        if r.status_code == 200:
            status = r.json()["latest"]["status"]
            if status in terminal:
                break
        time.sleep(1)
    assert status == "completed", f"tenant-b doc ended in status={status}"
    return {"client": client, "document_id": document_id, "b_headers": b_headers}


def _mint(tenant_id: str, sub: str, principals: list[str]) -> dict[str, str]:
    token = auth.create_dev_token(sub=sub, tenant_id=tenant_id, principals=principals)
    return {"Authorization": f"Bearer {token}"}


def test_tenant_a_cannot_see_tenant_b_document(cross_tenant_docs, mint_token):
    client = cross_tenant_docs["client"]
    resp = client.get(f"/documents/{cross_tenant_docs['document_id']}", headers=mint_token("dave", principals=["tenant:tenant-a"]))
    assert resp.status_code == 404  # not merely empty -- must not confirm existence either


def test_tenant_a_search_does_not_leak_tenant_b_content(cross_tenant_docs, mint_token):
    client = cross_tenant_docs["client"]
    resp = client.post(
        "/search",
        json={"query": "tenant-b-only report Contoso pricing risks", "top_k": 20},
        headers=mint_token("dave", principals=["tenant:tenant-a"]),
    )
    assert resp.status_code == 200
    doc_ids = {r["document_id"] for r in resp.json()["results"]}
    assert cross_tenant_docs["document_id"] not in doc_ids


def test_tenant_b_cannot_see_tenant_a_documents(cross_tenant_docs, ingested):
    client = cross_tenant_docs["client"]
    contoso_a_id = ingested["doc_ids"]["contoso_original"]
    resp = client.get(f"/documents/{contoso_a_id}", headers=cross_tenant_docs["b_headers"])
    assert resp.status_code == 404


def test_tenant_b_search_does_not_leak_tenant_a_content(cross_tenant_docs):
    client = cross_tenant_docs["client"]
    resp = client.post(
        "/search",
        json={"query": "Contoso pricing risks Acme Corp", "top_k": 20},
        headers=cross_tenant_docs["b_headers"],
    )
    assert resp.status_code == 200
    doc_ids = {r["document_id"] for r in resp.json()["results"]}
    assert doc_ids <= {cross_tenant_docs["document_id"]}  # only ever its own tenant's doc, if any


# --------------------------------------------------------------------------
# Audit trail: complete and queryable for a given answer
# --------------------------------------------------------------------------


def test_search_request_is_recorded_in_the_audit_trail(ingested):
    client = ingested["client"]
    resp = client.post("/search", json={"query": "Contoso pricing risks", "top_k": 5})
    assert resp.status_code == 200
    returned_ids = {r["chunk_id"] for r in resp.json()["results"]}

    audit_resp = client.get("/system/audit", params={"endpoint": "/search", "limit": 5})
    assert audit_resp.status_code == 200
    entries = audit_resp.json()["entries"]
    assert entries, "expected at least one /search audit entry"
    latest = entries[0]
    assert latest["endpoint"] == "/search"
    assert latest["tenant_id"] == "tenant-a"
    assert latest["identity_sub"] == "test-runner"
    assert set(latest["evidence_chunk_ids"]) == returned_ids


def test_graph_query_is_recorded_in_the_audit_trail(ingested):
    client = ingested["client"]
    resp = client.post("/graph/query", json={"predicate": "MENTIONED_COMPETITOR"})
    assert resp.status_code == 200

    audit_resp = client.get("/system/audit", params={"endpoint": "/graph/query", "limit": 1})
    entries = audit_resp.json()["entries"]
    assert entries
    assert entries[0]["endpoint"] == "/graph/query"
