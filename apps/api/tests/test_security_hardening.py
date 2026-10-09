"""Regression tests for the security-hardening pass and Word upload support.

Each test pins one concrete vulnerability that existed before the fix (or
one feature promise), so a future change that reopens it fails loudly.
"""
from __future__ import annotations

import io
import time
import zipfile

import pytest

CT = (
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/'
    'content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
)
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _docx(paragraphs: list[tuple[str | None, str]], extra: dict[str, bytes] | None = None) -> bytes:
    body = ""
    for style, text in paragraphs:
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        body += f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CT)
        z.writestr(
            "word/document.xml",
            f'<?xml version="1.0" encoding="UTF-8"?><w:document {W}><w:body>{body}</w:body></w:document>',
        )
        for k, v in (extra or {}).items():
            z.writestr(k, v)
    return buf.getvalue()


def _wait_terminal(client, document_id: str, timeout: float = 120) -> str:
    deadline = time.time() + timeout
    status = None
    while time.time() < deadline:
        status = client.get(f"/documents/{document_id}").json()["latest"]["status"]
        if status in {"completed", "failed", "dead_lettered", "quarantined"}:
            return status
        time.sleep(1)
    return status


# --------------------------------------------------------------- Word upload


def test_docx_upload_is_converted_ingested_and_searchable(ingested):
    client = ingested["client"]
    data = _docx(
        [
            ("Heading1", "Initech Quarterly Call Report"),
            (None, "Initech confirmed the Zephyrquill migration budget of 4.2 million."),
            ("Heading2", "Next steps"),
            (None, "Schedule the Zephyrquill pilot review."),
        ]
    )
    resp = client.post(
        "/documents/upload",
        files={
            "files": (
                "initech.docx",
                data,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        data={"customer_name": "Initech", "classification": "internal"},
    )
    assert resp.status_code == 200, resp.text
    result = resp.json()["results"][0]
    assert result["status"] == "queued", result
    assert result["original_format"] == "docx"
    assert _wait_terminal(client, result["document_id"]) == "completed"

    # the converted PDF is what the viewer serves
    pdf = client.get(f"/documents/{result['document_id']}/file")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")

    hits = client.post("/search", json={"query": "Zephyrquill migration budget", "top_k": 5}).json()
    assert any(r["document_id"] == result["document_id"] for r in hits["results"]), hits


@pytest.mark.parametrize(
    "filename,content",
    [
        ("notes.txt", b"plain text"),
        ("image.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64),
        ("payload.exe", b"MZ" + b"\x00" * 64),
        ("renamed.pdf", b"MZ" + b"\x00" * 64),          # extension lies about content
        ("renamed.docx", b"%PDF-1.4\n%%EOF"),            # PDF disguised as Word
    ],
)
def test_non_pdf_non_word_files_are_rejected(ingested, filename, content):
    resp = ingested["client"].post(
        "/documents/upload", files={"files": (filename, content, "application/octet-stream")}
    )
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "rejected"
    assert "cannot be accepted" in result["message"]


def test_macro_enabled_word_document_is_rejected(ingested):
    data = _docx([(None, "hello")], extra={"word/vbaProject.bin": b"\x00" * 32})
    result = ingested["client"].post(
        "/documents/upload", files={"files": ("macro.docx", data, "application/octet-stream")}
    ).json()["results"][0]
    assert result["status"] == "rejected"


def test_invalid_classification_is_rejected(ingested):
    resp = ingested["client"].post(
        "/documents/upload",
        files={"files": ("x.docx", _docx([(None, "hi")]), "application/octet-stream")},
        data={"classification": "top-secret"},
    )
    assert resp.status_code == 400


# --------------------------------------------------------------- authN / authZ


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/system/insights"),
        ("get", "/system/metrics"),
        ("get", "/system/audit"),
        ("get", "/system/admin/overview"),
        ("post", "/system/disaster-recovery/drill"),
        ("get", "/chat/traces"),
        ("post", "/search/reindex"),
        ("post", "/evaluation/run"),
        ("get", "/observability/dashboard"),
    ],
)
def test_previously_public_endpoints_now_require_auth(ingested, method, path):
    client = ingested["client"]
    resp = getattr(client, method)(path, headers={"Authorization": ""})
    assert resp.status_code == 401, (path, resp.status_code)


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/system/admin/overview"),
        ("post", "/system/disaster-recovery/drill"),
        ("post", "/search/reindex"),
        ("post", "/evaluation/run"),
        ("get", "/observability/dashboard"),
        ("get", "/system/audit"),
    ],
)
def test_customer_role_cannot_reach_admin_endpoints(ingested, mint_token, method, path):
    headers = mint_token("cust-1", principals=["tenant:tenant-a"])  # role defaults to customer
    resp = getattr(ingested["client"], method)(path, headers=headers)
    assert resp.status_code == 403, (path, resp.status_code)


def test_insights_never_leak_another_tenants_documents(ingested, mint_token):
    other = mint_token("eve", tenant_id="tenant-zzz", principals=["tenant:tenant-zzz"])
    resp = ingested["client"].get("/system/insights", headers=other)
    assert resp.status_code == 200
    tenant_a_ids = set(ingested["doc_ids"].values())
    assert not any(i["document_id"] in tenant_a_ids for i in resp.json()["insights"])


def test_token_without_audience_is_rejected(ingested):
    import jwt

    from app import config

    now = int(time.time())
    token = jwt.encode(
        {"sub": "x", "tenant_id": "tenant-a", "principals": ["tenant:tenant-a"], "iat": now, "exp": now + 60},
        config.AUTH_SECRET,
        algorithm="HS256",
    )
    resp = ingested["client"].get("/auth/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_dev_token_role_escalation_requires_dev_mode(ingested, monkeypatch):
    from app import config
    from app.routers import auth as auth_router

    monkeypatch.setattr(config, "AUTH_DEV_MODE", False)
    monkeypatch.setattr(auth_router.config, "AUTH_DEV_MODE", False)
    resp = ingested["client"].post(
        "/auth/dev-token", json={"sub": "x", "tenant_id": "tenant-a", "role": "super_admin"}
    )
    assert resp.status_code == 404


def test_auth_dev_mode_is_off_by_default_and_insecure_secret_refused(tmp_path):
    """Checked in a clean subprocess with no .env file: conftest forces
    AUTH_DEV_MODE=true for the suite, and app.config reads apps/api/.env."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    api_root = Path(__file__).resolve().parent.parent
    env = {k: v for k, v in os.environ.items() if k not in ("AUTH_DEV_MODE", "AUTH_SECRET", "APP_ENV")}
    env["TATHYX_ENV_FILE"] = str(tmp_path / "does-not-exist.env")
    probe = "\n".join(
        [
            "from app import config",
            "assert config.AUTH_DEV_MODE is False, config.AUTH_DEV_MODE",
            "try:",
            "    config.validate_security_config()",
            "    print('started-insecurely')",
            "except RuntimeError:",
            "    print('refused')",
        ]
    )
    out = subprocess.run([sys.executable, "-c", probe], cwd=str(api_root), env=env, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "refused"


def test_user_cannot_delete_another_users_memory(ingested, mint_token):
    client = ingested["client"]
    alice = mint_token("alice-mem", principals=["tenant:tenant-a"])
    bob = mint_token("bob-mem", principals=["tenant:tenant-a"])
    created = client.post(
        "/learning/memories/user",
        json={"category": "preference", "key": "style", "content": "Alice prefers concise answers"},
        headers=alice,
    )
    assert created.status_code == 200, created.text
    memory_id = created.json()["memory_id"]
    assert memory_id, created.json()
    assert client.delete(f"/learning/memories/user/{memory_id}", headers=bob).status_code == 404
    assert client.delete(f"/learning/memories/user/{memory_id}", headers=alice).status_code == 200


def test_figure_path_traversal_is_blocked(ingested):
    client = ingested["client"]
    doc_id = ingested["doc_ids"]["contoso_original"]
    for name in ["..\\..\\..\\raw\\tenant-a\\x\\1\\source.pdf", "..%5C..%5Csource.pdf", "...."]:
        assert client.get(f"/documents/{doc_id}/figures/{name}").status_code == 404


def test_security_headers_present(ingested):
    resp = ingested["client"].get("/system/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Cache-Control"] == "no-store"


def test_oversized_body_rejected_before_read(ingested):
    resp = ingested["client"].post(
        "/search", content=b"{}", headers={"Content-Type": "application/json", "Content-Length": str(50 * 1024 * 1024)}
    )
    assert resp.status_code == 413


# --------------------------------------------------------------- index integrity


def test_rollback_keeps_documents_ingested_after_the_switch_searchable(ingested):
    """Regression: a rollback used to re-activate an index version that had
    never seen documents ingested after the switch, leaving them in the DB
    but invisible to vector search."""
    from app import db
    from app.services import search_index

    client = ingested["client"]
    original = search_index.get_active_index_name()
    new_name, _ = search_index.build_new_index_version()
    search_index.switch_active_index(new_name)

    data = _docx([("Heading1", "Vandelay Industries Call Report"), (None, "Vandelay asked about latex import financing.")])
    result = client.post(
        "/documents/upload", files={"files": ("vandelay.docx", data, "application/octet-stream")}
    ).json()["results"][0]
    assert _wait_terminal(client, result["document_id"]) == "completed"

    search_index.rollback_active_index(original)

    chunk_ids = {
        r["chunk_id"]
        for r in db.rows_to_list(
            db.get_connection()
            .execute("SELECT chunk_id FROM chunks WHERE document_id = ?", (result["document_id"],))
            .fetchall()
        )
    }
    assert chunk_ids, "expected the new document to be chunked"
    indexed = set(search_index.get_index_manager()._id_map["chunk_to_label"].keys())
    assert chunk_ids <= indexed
