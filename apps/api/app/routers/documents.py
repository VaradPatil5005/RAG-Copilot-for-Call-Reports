from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app import db
from app.services import auth, document_conversion, pipeline, storage, validation

ALLOWED_CLASSIFICATIONS = {"public", "internal", "confidential", "restricted"}
MAX_FILES_PER_UPLOAD = 20
MAX_METADATA_FIELD_LENGTH = 200
_FIGURE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$")

router = APIRouter(prefix="/documents", tags=["documents"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_document_id() -> str:
    """CSPRNG-based and re-drawn on collision -- the old `random.choices`
    6-digit suffix was predictable, and a collision raised an IntegrityError
    (HTTP 500) on the documents primary key."""
    year = datetime.now(timezone.utc).year
    conn = db.get_connection()
    for _ in range(20):
        candidate = f"CR-{year}-{secrets.randbelow(10**8):08d}"
        if not conn.execute("SELECT 1 FROM documents WHERE document_id = ?", (candidate,)).fetchone():
            return candidate
    raise HTTPException(503, "Could not allocate a document id, please retry")


def _clean_text_field(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > MAX_METADATA_FIELD_LENGTH or any(ord(ch) < 32 for ch in value):
        raise HTTPException(400, f"Invalid {field}")
    return value


def _clean_classification(value: str | None) -> str:
    value = (value or "internal").strip().lower()
    if value not in ALLOWED_CLASSIFICATIONS:
        raise HTTPException(400, f"classification must be one of {sorted(ALLOWED_CLASSIFICATIONS)}")
    return value


def _safe_filename(name: str | None) -> str:
    """Display-only name: drop any client-supplied directory part and
    control characters."""
    base = re.split(r"[\\/]", name or "")[-1]
    base = "".join(ch for ch in base if ord(ch) >= 32).strip()
    return base[:255] or "untitled"


def _document_authorized(doc_row: dict, identity: auth.Identity) -> bool:
    """Phase 6.3: document-level authorization for GET/PATCH endpoints,
    using the same ACL construction rule the ingestion pipeline uses to
    build a chunk's `acl_principals` (tenant/owner/customer) -- so a
    document is visible here under exactly the same rule it would be
    surfaced under by /search or /chat, not a separately-invented one."""
    if doc_row["tenant_id"] != identity.tenant_id:
        return False
    if (doc_row.get("classification") or "internal").lower() == "public":
        return True
    principals = set(identity.principals)
    if f"tenant:{doc_row['tenant_id']}" in principals:
        return True
    if doc_row.get("account_owner") and f"owner:{doc_row['account_owner']}" in principals:
        return True
    if doc_row.get("customer_name") and f"customer:{doc_row['customer_name']}" in principals:
        return True
    return False


def _require_document_access(document_id: str, identity: auth.Identity) -> dict:
    conn = db.get_connection()
    doc_row = db.row_to_dict(
        conn.execute("SELECT * FROM documents WHERE document_id = ?", (document_id,)).fetchone()
    )
    if not doc_row:
        raise HTTPException(404, "Document not found")
    if not _document_authorized(doc_row, identity):
        # 404, not 403 -- do not confirm to an unauthorized caller that a
        # document with this ID even exists (same posture the blueprint
        # takes for chunk-level ACL: no signal leaks past the filter).
        raise HTTPException(404, "Document not found")
    return doc_row


def _version_row_to_out(row: dict) -> dict:
    return {
        "document_id": row["document_id"],
        "version": row["version"],
        "sha256": row["sha256"],
        "status": row["status"],
        "stage": row["stage"],
        "error": row["error"],
        "size_bytes": row["size_bytes"],
        "page_count": row["page_count"],
        "table_count": row["table_count"] or 0,
        "figure_count": row["figure_count"] or 0,
        "heading_count": row["heading_count"] or 0,
        "ocr_pages": row["ocr_pages"] or 0,
        "ocr_confidence": row["ocr_confidence"],
        "parser": row["parser"],
        "parser_version": row["parser_version"],
        "duplicate_of": row["duplicate_of"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _document_row_to_out(doc_row: dict, version_row: dict | None) -> dict:
    return {
        "document_id": doc_row["document_id"],
        "tenant_id": doc_row["tenant_id"],
        "filename": doc_row["filename"],
        "customer_name": doc_row["customer_name"],
        "account_owner": doc_row["account_owner"],
        "meeting_date": doc_row["meeting_date"],
        "classification": doc_row["classification"],
        "current_version": doc_row["current_version"],
        "created_at": doc_row["created_at"],
        "latest": _version_row_to_out(version_row) if version_row else None,
    }


@router.post("/upload")
async def upload_documents(
    request: Request,
    files: list[UploadFile],
    customer_name: str | None = Form(None),
    account_owner: str | None = Form(None),
    meeting_date: str | None = Form(None),
    classification: str = Form("internal"),
    identity: auth.Identity = Depends(auth.require_identity),
):
    # Phase 6.3: tenant_id is no longer a client-supplied form field --
    # every uploaded document belongs to the authenticated caller's
    # tenant, resolved server-side, same as every other endpoint here.
    tenant_id = identity.tenant_id
    if not files:
        raise HTTPException(400, "No files provided")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(400, f"At most {MAX_FILES_PER_UPLOAD} files per upload")
    customer_name = _clean_text_field(customer_name, "customer_name")
    account_owner = _clean_text_field(account_owner, "account_owner")
    meeting_date = _clean_text_field(meeting_date, "meeting_date")
    classification = _clean_classification(classification)

    queue: pipeline.IngestionQueue = request.app.state.ingestion_queue
    results = []

    for upload in files:
        filename = _safe_filename(upload.filename)
        if document_conversion.extension_of(filename) not in document_conversion.ALLOWED_EXTENSIONS:
            results.append(
                {
                    "filename": filename,
                    "status": "rejected",
                    "message": "File cannot be accepted. Only PDF and Word documents (.pdf, .docx, .doc) are allowed.",
                }
            )
            continue

        # Read at most limit+1 bytes so an oversized upload is rejected
        # without buffering more than the limit in memory.
        data = await upload.read(validation.MAX_FILE_SIZE_BYTES + 1)
        try:
            prepared = await run_in_threadpool(document_conversion.prepare_upload, filename, data)
        except document_conversion.ConversionError as exc:
            results.append({"filename": filename, "status": "rejected", "message": exc.message})
            continue

        # Checksum the bytes the user actually sent, so re-uploading the same
        # Word file is still detected as a duplicate (conversion output is not
        # byte-for-byte reproducible).
        checksum = storage.sha256_bytes(prepared.original_bytes)

        # Idempotent duplicate detection: same tenant + same checksum
        existing = db.row_to_dict(
            db.get_connection()
            .execute(
                "SELECT dv.document_id, dv.version, dv.status FROM document_versions dv "
                "JOIN documents d ON d.document_id = dv.document_id "
                "WHERE d.tenant_id = ? AND dv.sha256 = ? ORDER BY dv.version DESC LIMIT 1",
                (tenant_id, checksum),
            )
            .fetchone()
        )
        if existing:
            results.append(
                {
                    "filename": filename,
                    "document_id": existing["document_id"],
                    "version": existing["version"],
                    "status": "duplicate",
                    "message": f"Identical content already processed as {existing['document_id']} "
                    f"(v{existing['version']}, {existing['status']})",
                }
            )
            continue

        document_id = _new_document_id()
        version = 1
        now = _now()

        with db.tx() as conn:
            conn.execute(
                "INSERT INTO documents (document_id, tenant_id, filename, customer_name, account_owner, "
                "meeting_date, classification, current_version, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (document_id, tenant_id, filename, customer_name, account_owner, meeting_date, classification, 1, now),
            )

        file_path = storage.save_raw_pdf(tenant_id, document_id, version, prepared.pdf_bytes)
        if prepared.kind != "pdf":
            storage.save_raw_original(
                tenant_id, document_id, version, prepared.original_extension, prepared.original_bytes
            )
        storage.save_metadata_sidecar(
            tenant_id,
            document_id,
            version,
            {
                "tenant_id": tenant_id,
                "document_id": document_id,
                "version": version,
                "filename": filename,
                "original_format": prepared.kind,
                "customer_name": customer_name,
                "account_owner": account_owner,
                "meeting_date": meeting_date,
                "classification": classification,
                "sha256": checksum,
                "uploaded_by": identity.sub,
                "uploaded_at": now,
            },
        )

        with db.tx() as conn:
            conn.execute(
                "INSERT INTO document_versions (document_id, version, sha256, status, stage, file_path, "
                "size_bytes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (document_id, version, checksum, "queued", "queued", file_path, len(prepared.original_bytes), now, now),
            )
        received = f"{len(prepared.original_bytes)} bytes"
        if prepared.kind != "pdf":
            received += f" ({prepared.kind} converted to PDF, {len(prepared.pdf_bytes)} bytes)"
        pipeline.log_event(document_id, version, "uploaded", "received", received)
        pipeline.log_event(document_id, version, "queued", "queued", "Waiting for a worker")

        await queue.enqueue(document_id, version)

        results.append(
            {
                "filename": filename,
                "document_id": document_id,
                "version": version,
                "status": "queued",
                "original_format": prepared.kind,
            }
        )

    return {"results": results}


@router.get("")
def list_documents(
    status: str | None = None,
    customer: str | None = None,
    owner: str | None = None,
    classification: str | None = None,
    q: str | None = None,
    identity: auth.Identity = Depends(auth.require_identity),
):
    tenant_id = identity.tenant_id
    conn = db.get_connection()
    query = (
        "SELECT d.*, dv.version as v_version, dv.sha256, dv.status as v_status, dv.stage, dv.error, "
        "dv.size_bytes, dv.page_count, dv.table_count, dv.figure_count, dv.heading_count, dv.ocr_pages, "
        "dv.ocr_confidence, dv.parser, dv.parser_version, dv.duplicate_of, "
        "dv.created_at as v_created_at, dv.updated_at as v_updated_at "
        "FROM documents d "
        "LEFT JOIN document_versions dv ON dv.document_id = d.document_id AND dv.version = d.current_version "
        "WHERE d.tenant_id = ?"
    )
    params: list = [tenant_id]
    if status:
        query += " AND dv.status = ?"
        params.append(status)
    if customer:
        query += " AND d.customer_name LIKE ?"
        params.append(f"%{customer}%")
    if owner:
        query += " AND d.account_owner LIKE ?"
        params.append(f"%{owner}%")
    if classification:
        query += " AND d.classification = ?"
        params.append(classification)
    if q:
        query += " AND (d.filename LIKE ? OR d.document_id LIKE ? OR d.customer_name LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    query += " ORDER BY d.created_at DESC"

    rows = db.rows_to_list(conn.execute(query, params).fetchall())
    out = []
    for r in rows:
        doc_row = {
            "document_id": r["document_id"],
            "tenant_id": r["tenant_id"],
            "filename": r["filename"],
            "customer_name": r["customer_name"],
            "account_owner": r["account_owner"],
            "meeting_date": r["meeting_date"],
            "classification": r["classification"],
            "current_version": r["current_version"],
            "created_at": r["created_at"],
        }
        # Phase 6.3: document-level ACL, same rule as chunk-level ACL.
        if not _document_authorized(doc_row, identity):
            continue
        version_row = None
        if r.get("v_version") is not None:
            version_row = {
                "document_id": r["document_id"],
                "version": r["v_version"],
                "sha256": r["sha256"],
                "status": r["v_status"],
                "stage": r["stage"],
                "error": r["error"],
                "size_bytes": r["size_bytes"],
                "page_count": r["page_count"],
                "table_count": r["table_count"],
                "figure_count": r["figure_count"],
                "heading_count": r["heading_count"],
                "ocr_pages": r["ocr_pages"],
                "ocr_confidence": r["ocr_confidence"],
                "parser": r["parser"],
                "parser_version": r["parser_version"],
                "duplicate_of": r["duplicate_of"],
                "created_at": r["v_created_at"],
                "updated_at": r["v_updated_at"],
            }
        out.append(_document_row_to_out(doc_row, version_row))
    return {"documents": out}


@router.get("/stats")
def document_stats(identity: auth.Identity = Depends(auth.require_identity)):
    tenant_id = identity.tenant_id
    conn = db.get_connection()
    rows = db.rows_to_list(
        conn.execute(
            "SELECT d.customer_name, d.account_owner, d.classification, dv.status, dv.page_count, "
            "dv.table_count, dv.figure_count FROM document_versions dv "
            "JOIN documents d ON d.document_id = dv.document_id AND dv.version = d.current_version "
            "WHERE d.tenant_id = ?",
            (tenant_id,),
        ).fetchall()
    )
    rows = [r for r in rows if _document_authorized(dict(r, tenant_id=tenant_id), identity)]
    processing_statuses = {"queued", "validating", "extracting", "multimodal_extraction", "normalizing"}
    stats = {
        "total": len(rows),
        "completed": sum(1 for r in rows if r["status"] == "completed"),
        "processing": sum(1 for r in rows if r["status"] in processing_statuses),
        "failed": sum(1 for r in rows if r["status"] in ("failed", "dead_lettered")),
        "quarantined": sum(1 for r in rows if r["status"] == "quarantined"),
        "duplicate": sum(1 for r in rows if r["status"] == "duplicate"),
        "total_pages": sum(r["page_count"] or 0 for r in rows),
        "total_tables": sum(r["table_count"] or 0 for r in rows),
        "total_figures": sum(r["figure_count"] or 0 for r in rows),
    }
    return stats


@router.get("/{document_id}")
def get_document(document_id: str, identity: auth.Identity = Depends(auth.require_identity)):
    doc_row = _require_document_access(document_id, identity)
    conn = db.get_connection()
    versions = db.rows_to_list(
        conn.execute(
            "SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC", (document_id,)
        ).fetchall()
    )
    latest = versions[0] if versions else None
    events = db.rows_to_list(
        conn.execute(
            "SELECT stage, status, message, created_at, version FROM processing_events "
            "WHERE document_id = ? ORDER BY id ASC",
            (document_id,),
        ).fetchall()
    )
    out = _document_row_to_out(doc_row, latest)
    out["versions"] = [_version_row_to_out(v) for v in versions]
    out["events"] = events
    return out


@router.get("/{document_id}/elements")
def get_elements(
    document_id: str,
    version: int | None = None,
    element_type: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
    identity: auth.Identity = Depends(auth.require_identity),
):
    _require_document_access(document_id, identity)
    conn = db.get_connection()
    if version is None:
        doc = db.row_to_dict(
            conn.execute("SELECT current_version FROM documents WHERE document_id = ?", (document_id,)).fetchone()
        )
        version = doc["current_version"]

    query = "SELECT * FROM elements WHERE document_id = ? AND version = ?"
    params: list = [document_id, version]
    if element_type:
        query += " AND element_type = ?"
        params.append(element_type)
    query += " ORDER BY page_number ASC, element_id ASC LIMIT ?"
    params.append(limit)

    rows = db.rows_to_list(conn.execute(query, params).fetchall())
    out = []
    for r in rows:
        out.append(
            {
                "element_id": r["element_id"],
                "page_number": r["page_number"],
                "element_type": r["element_type"],
                "heading_level": r["heading_level"],
                "section_path": db.loads(r["section_path"], []),
                "text": r["text"],
                "markdown": r["markdown"],
                "bbox": db.loads(r["bbox"]),
                "confidence": r["confidence"],
                "table_json": db.loads(r["table_json"]),
                "figure_path": r["figure_path"],
                "ocr": bool(r["ocr"]),
                "include_in_search": bool(r["include_in_search"]),
                "description": r["description"],
            }
        )
    return {"elements": out, "version": version}


@router.get("/{document_id}/figures/{filename}")
def get_figure(
    document_id: str,
    filename: str,
    version: int | None = None,
    identity: auth.Identity = Depends(auth.require_identity),
):
    doc = _require_document_access(document_id, identity)
    # `filename` is attacker-controlled. On Windows a backslash is a path
    # separator, so a name like "..\\..\\..\\<other tenant>\\...\\source.pdf"
    # would escape the figures directory. Allow-list the name, then confirm
    # the resolved path is still directly inside the figures directory.
    if not _FIGURE_NAME_RE.fullmatch(filename) or ".." in filename:
        raise HTTPException(404, "Figure not found")
    v = version or doc["current_version"]
    base = storage.figures_dir(doc["tenant_id"], document_id, v).resolve()
    path = (base / filename).resolve()
    if path.parent != base or not path.is_file():
        raise HTTPException(404, "Figure not found")
    return FileResponse(str(path))


@router.get("/{document_id}/file")
def get_document_file(
    document_id: str,
    version: int | None = None,
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """Serve the authentic source PDF for full document viewing and download."""
    if token and not authorization:
        authorization = f"Bearer {token}"
    identity = auth.require_identity(authorization)
    doc = _require_document_access(document_id, identity)
    v = version or doc["current_version"]
    path = storage.raw_dir(doc["tenant_id"], document_id, v) / "source.pdf"
    if not path.exists():
        raise HTTPException(404, "Source PDF file not found")
    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename=doc.get("filename") or f"{document_id}.pdf",
    )


@router.patch("/{document_id}")
async def update_document_metadata(
    document_id: str,
    payload: dict,
    request: Request,
    identity: auth.Identity = Depends(auth.require_identity),
):
    """Manual metadata edit — fixes documents uploaded before auto-detection
    existed, or corrects a wrong auto-detected/typed value.

    `classification`, `account_owner` and `customer_name` feed the ACL
    stamped onto every chunk and graph edge at ingestion time. Changing
    them only on the `documents` row would leave search/chat/graph
    enforcing the *old* ACL (a report reclassified from public to
    confidential would stay visible tenant-wide), so an ACL-relevant edit
    re-queues the document to rebuild those rows."""
    doc_row = _require_document_access(document_id, identity)
    allowed = {"customer_name", "account_owner", "meeting_date", "classification"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if not updates:
        raise HTTPException(400, f"No editable fields provided. Allowed: {sorted(allowed)}")
    for k, v in list(updates.items()):
        if v is not None and not isinstance(v, str):
            raise HTTPException(400, f"Invalid {k}")
        updates[k] = _clean_classification(v) if k == "classification" else _clean_text_field(v, k)

    with db.tx() as conn:
        cols = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE documents SET {cols} WHERE document_id = ?", (*updates.values(), document_id))

    acl_fields = {"classification", "account_owner", "customer_name"}
    acl_changed = any(k in acl_fields and updates[k] != doc_row.get(k) for k in updates)
    if acl_changed:
        version = doc_row["current_version"]
        pipeline.log_event(document_id, version, "queued", "requeued", "Metadata changed -- rebuilding ACLs")
        pipeline.set_status(document_id, version, "queued", "queued", error=None)
        queue: pipeline.IngestionQueue = request.app.state.ingestion_queue
        await queue.enqueue(document_id, version)

    return {"document_id": document_id, "updated": updates, "acl_rebuild_queued": acl_changed}


@router.post("/{document_id}/reprocess")
async def reprocess_document(
    document_id: str,
    request: Request,
    force: bool = False,
    identity: auth.Identity = Depends(auth.require_identity),
):
    _require_document_access(document_id, identity)
    conn = db.get_connection()
    latest = db.row_to_dict(
        conn.execute(
            "SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC LIMIT 1",
            (document_id,),
        ).fetchone()
    )
    if not latest:
        raise HTTPException(404, "No versions found")

    if latest["status"] == "completed" and not force:
        return {
            "message": "Already processed with the current parser version — no-op. "
            "Pass force=true to reprocess anyway.",
            "document_id": document_id,
            "version": latest["version"],
            "status": latest["status"],
        }

    version = latest["version"]
    pipeline.log_event(document_id, version, "queued", "requeued", "Manual reprocess requested")
    pipeline.set_status(document_id, version, "queued", "queued", error=None)
    queue: pipeline.IngestionQueue = request.app.state.ingestion_queue
    await queue.enqueue(document_id, version)
    return {"message": "Reprocessing queued", "document_id": document_id, "version": version}
