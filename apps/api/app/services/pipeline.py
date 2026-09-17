"""Ingestion pipeline orchestrator.

Substitutes Event Grid + Service Bus + Durable Functions with an in-process
asyncio queue and a small worker pool (see docs/decisions/0001). The stage
contract is the same as the target architecture:

    queued -> validating -> extracting -> normalizing
            -> chunking -> embedding -> indexing -> completed
                  (branch) -> quarantined (validation failed)
                  (branch) -> duplicate  (checksum already processed)
    (extracting|normalizing|chunking|embedding|indexing)
            -> failed (after 1 retry) -> dead-lettered

`chunking` / `embedding` / `indexing` are Phase 3 additions: elements ->
hierarchical passages/tables/figures (services/chunking.py) -> dense
embeddings + hybrid index entries (services/embeddings.py,
services/search_index.py). `embedding` and `indexing` are logged as
distinct stages for UI visibility even though the underlying
IndexManager.upsert_chunks call performs both together (embed-then-add is
one batched operation, not two round trips worth separating internally).

Every transition is written to `processing_events` so the UI can render a
live per-document timeline, and to `document_versions.status/stage` for fast
polling.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from app import db
from app.services import chunking, embeddings, extraction, graph_extraction, multimodal_extraction, pii, search_index, storage, validation, metadata_sniff

logger = logging.getLogger("ingestion.pipeline")

MAX_ATTEMPTS = 2
WORKER_COUNT = 2


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(document_id: str, version: int, stage: str, status: str, message: str | None = None) -> None:
    with db.tx() as conn:
        conn.execute(
            "INSERT INTO processing_events (document_id, version, stage, status, message, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (document_id, version, stage, status, message, _now()),
        )


def set_status(document_id: str, version: int, status: str, stage: str, **fields) -> None:
    cols = ["status = ?", "stage = ?", "updated_at = ?"]
    params: list = [status, stage, _now()]
    for k, v in fields.items():
        cols.append(f"{k} = ?")
        params.append(v)
    params.extend([document_id, version])
    with db.tx() as conn:
        conn.execute(
            f"UPDATE document_versions SET {', '.join(cols)} WHERE document_id = ? AND version = ?",
            params,
        )


class IngestionQueue:
    """Thin wrapper so FastAPI lifespan can own the queue + workers."""

    def __init__(self) -> None:
        self.queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []

    def start(self) -> None:
        loop = asyncio.get_event_loop()
        for _ in range(WORKER_COUNT):
            self._workers.append(loop.create_task(self._worker_loop()))
        logger.info("Ingestion workers started (%d)", WORKER_COUNT)
        # Recover any documents interrupted in an active stage across server restarts or reloads
        try:
            conn = db.get_connection()
            interrupted = db.rows_to_list(
                conn.execute(
                    "SELECT document_id, version FROM document_versions "
                    "WHERE status NOT IN ('completed', 'failed', 'dead_lettered', 'quarantined', 'duplicate')"
                ).fetchall()
            )
            for r in interrupted:
                logger.info("Re-enqueuing interrupted document %s v%d", r["document_id"], r["version"])
                self.queue.put_nowait((r["document_id"], r["version"]))
        except Exception:
            logger.exception("Failed to re-enqueue interrupted documents on startup")

    async def stop(self) -> None:
        for w in self._workers:
            w.cancel()

    async def enqueue(self, document_id: str, version: int) -> None:
        await self.queue.put((document_id, version))

    @property
    def queue_depth(self) -> int:
        """Phase 6.6: surfaced in the Admin panel's system-health view --
        a real live measurement (`asyncio.Queue.qsize()`), not an
        estimate."""
        return self.queue.qsize()

    async def _worker_loop(self) -> None:
        loop = asyncio.get_event_loop()
        while True:
            document_id, version = await self.queue.get()
            try:
                await loop.run_in_executor(None, process_document, document_id, version)
            except Exception:
                logger.exception("Unhandled pipeline error for %s v%d", document_id, version)
            finally:
                self.queue.task_done()


def process_document(document_id: str, version: int, attempt: int = 1) -> None:
    """Runs on a worker thread — the actual CPU-bound extraction happens here."""
    row = db.row_to_dict(
        db.get_connection()
        .execute(
            "SELECT dv.*, d.tenant_id, d.classification FROM document_versions dv "
            "JOIN documents d ON d.document_id = dv.document_id "
            "WHERE dv.document_id = ? AND dv.version = ?",
            (document_id, version),
        )
        .fetchone()
    )
    if row is None:
        logger.error("process_document: no such version %s v%d", document_id, version)
        return

    tenant_id = row["tenant_id"]
    file_path = row["file_path"]

    try:
        # --- Stage: validating ---------------------------------------
        set_status(document_id, version, "validating", "validating")
        log_event(document_id, version, "validating", "started")

        data = Path(file_path).read_bytes()
        for check in (validation.check_signature, validation.check_size):
            result = check(data)
            if not result.ok:
                set_status(document_id, version, "quarantined", "quarantined", error=result.detail)
                log_event(document_id, version, "validating", "quarantined", f"{result.reason}: {result.detail}")
                return

        malware = validation.malware_scan_stub(data)
        log_event(document_id, version, "validating", "malware_scan_clean", malware.detail)

        # Page count needs the file opened — do it via extraction's own fitz open
        import pymupdf as fitz  # local import keeps worker startup light

        probe = fitz.open(file_path)
        page_count = probe.page_count
        probe.close()
        page_check = validation.check_page_count(page_count)
        if not page_check.ok:
            set_status(document_id, version, "quarantined", "quarantined", error=page_check.detail)
            log_event(document_id, version, "validating", "quarantined", page_check.detail)
            return

        log_event(document_id, version, "validating", "passed", f"{page_count} pages")

        # --- Stage: extracting -----------------------------------------
        set_status(document_id, version, "extracting", "extracting")
        log_event(document_id, version, "extracting", "started", "Layout extraction (PyMuPDF) + OCR fallback")

        figures_dir = storage.figures_dir(tenant_id, document_id, version)
        elements, stats = extraction.extract(file_path, document_id, version, figures_dir)

        log_event(
            document_id,
            version,
            "extracting",
            "completed",
            f"{stats.page_count} pages, {stats.table_count} tables, {stats.figure_count} figures, "
            f"{stats.ocr_pages} OCR pages",
        )

        # --- Stage: multimodal_extraction (Phase 6.2) -------------------------
        # Runs on the in-memory `elements` list *before* it's persisted/
        # chunked, so a routed figure's enriched description flows through
        # the existing figure-chunk indexing path with no parallel path.
        # Must never fail ingestion -- a vision-provider error degrades to
        # the original OCR-only element content, not a pipeline failure.
        set_status(document_id, version, "multimodal_extraction", "multimodal_extraction")
        log_event(document_id, version, "multimodal_extraction", "started", "Evaluating routing rule")
        try:
            mm_stats, figure_records = multimodal_extraction.process_routed_elements(
                elements, figures_dir, document_id, version
            )
            log_event(
                document_id,
                version,
                "multimodal_extraction",
                "completed",
                f"{mm_stats.routed}/{mm_stats.total_elements} elements routed "
                f"({mm_stats.routed_pages}/{mm_stats.total_pages} pages, "
                f"{mm_stats.routed_page_percentage}%, extractor={mm_stats.extractor_used})",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("multimodal_extraction failed for %s v%d (non-fatal)", document_id, version)
            log_event(document_id, version, "multimodal_extraction", "error", str(exc))
            mm_stats = multimodal_extraction.MultimodalStats()
            figure_records = []

        # --- Stage: normalizing ------------------------------------------
        set_status(document_id, version, "normalizing", "normalizing")
        log_event(document_id, version, "normalizing", "started", "Building canonical element schema")

        with db.tx() as conn:
            conn.execute("DELETE FROM elements WHERE document_id = ? AND version = ?", (document_id, version))
            for el in elements:
                conn.execute(
                    "INSERT INTO elements (element_id, document_id, version, page_number, element_type, "
                    "heading_level, section_path, text, markdown, bbox, confidence, table_json, figure_path, "
                    "ocr, include_in_search, description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        el["element_id"],
                        document_id,
                        version,
                        el["page_number"],
                        el["element_type"],
                        el.get("heading_level"),
                        db.dumps(el.get("section_path", [])),
                        el.get("text"),
                        el.get("markdown"),
                        db.dumps(el.get("bbox")),
                        el.get("confidence"),
                        db.dumps(el.get("table_json")) if el.get("table_json") else None,
                        el.get("figure_path"),
                        1 if el.get("ocr") else 0,
                        1 if el.get("include_in_search", True) else 0,
                        el.get("description"),
                    ),
                )

        derived_dir = storage.derived_dir(tenant_id, document_id, version)
        storage.save_json(derived_dir / "elements.json", db.dumps(elements))
        if figure_records:
            storage.save_json(derived_dir / "figures.json", db.dumps(figure_records))

        log_event(document_id, version, "normalizing", "completed", f"{len(elements)} elements persisted")

        # --- Metadata auto-detection --------------------------------------
        # Only fills fields the uploader left blank; an explicit form value
        # (already in `documents`) always wins over anything sniffed here.
        doc_meta = db.row_to_dict(
            db.get_connection()
            .execute(
                "SELECT customer_name, account_owner, meeting_date, classification "
                "FROM documents WHERE document_id = ?",
                (document_id,),
            )
            .fetchone()
        )
        sniffed = metadata_sniff.sniff_metadata(elements)
        to_fill = {
            k: v
            for k, v in sniffed.items()
            if v and not (doc_meta or {}).get(k)
        }
        if to_fill:
            with db.tx() as conn:
                cols = ", ".join(f"{k} = ?" for k in to_fill)
                conn.execute(
                    f"UPDATE documents SET {cols} WHERE document_id = ?",
                    (*to_fill.values(), document_id),
                )
            log_event(
                document_id,
                version,
                "normalizing",
                "metadata_detected",
                "Filled from document content: " + ", ".join(f"{k}={v}" for k, v in to_fill.items()),
            )

        # --- Stage: chunking ------------------------------------------------
        set_status(document_id, version, "chunking", "chunking")
        log_event(document_id, version, "chunking", "started", "Building hierarchical passages/tables/figures")

        final_meta = {**(doc_meta or {}), **to_fill}
        meta = chunking.DocMeta(
            document_id=document_id,
            version=version,
            tenant_id=tenant_id,
            customer_name=final_meta.get("customer_name"),
            account_owner=final_meta.get("account_owner"),
            meeting_date=final_meta.get("meeting_date"),
        )
        chunks = chunking.build_chunks(meta, elements)

        # --- Phase 5: ACL principal derivation -----------------------------
        # No auth system exists yet, so principals are derived deterministically
        # from document metadata rather than an identity provider: every chunk
        # is readable by its tenant and by an account-owner-scoped principal;
        # a customer-scoped group principal supports "give sales-west access to
        # Contoso reports"-style filters later without a schema change. This is
        # a local stand-in for the blueprint's Section 9 ACL model — the filter
        # is still applied at retrieval time (search_index.py), never after
        # generation. See ADR 0006.
        doc_classification = final_meta.get("classification") or "internal"
        acl_principals = [f"tenant:{tenant_id}"]
        if final_meta.get("account_owner"):
            acl_principals.append(f"owner:{final_meta['account_owner']}")
        if final_meta.get("customer_name"):
            acl_principals.append(f"customer:{final_meta['customer_name']}")

        with db.tx() as conn:
            conn.execute("DELETE FROM chunks WHERE document_id = ? AND version = ?", (document_id, version))
            for c in chunks:
                pii_categories = pii.categories_present(c.get("raw_text"))
                conn.execute(
                    "INSERT INTO chunks (chunk_id, document_id, version, tenant_id, parent_section_id, "
                    "chunk_type, section_path, page_number, customer_name, account_owner, meeting_date, "
                    "content, raw_text, table_json, table_id, token_count, content_hash, embedding_model, "
                    "embedding_version, acl_principals, classification, pii_flags, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        c["chunk_id"],
                        c["document_id"],
                        c["version"],
                        c["tenant_id"],
                        c["parent_section_id"],
                        c["chunk_type"],
                        db.dumps(c["section_path"]),
                        c["page_number"],
                        c["customer_name"],
                        c["account_owner"],
                        c["meeting_date"],
                        c["content"],
                        c["raw_text"],
                        db.dumps(c["table_json"]) if c["table_json"] else None,
                        c["table_id"],
                        c["token_count"],
                        c["content_hash"],
                        None,
                        None,
                        db.dumps(acl_principals),
                        doc_classification,
                        db.dumps(pii_categories) if pii_categories else None,
                        c["created_at"],
                        c["updated_at"],
                    ),
                )
                if pii_categories:
                    log_event(
                        document_id, version, "chunking", "pii_detected",
                        f"{c['chunk_id']}: {pii_categories} (flagged only, content not redacted -- see services/pii.py)",
                    )

        table_chunks = sum(1 for c in chunks if c["chunk_type"] == "table")
        figure_chunks = sum(1 for c in chunks if c["chunk_type"] == "figure")
        passage_chunks = sum(1 for c in chunks if c["chunk_type"] == "passage")
        log_event(
            document_id,
            version,
            "chunking",
            "completed",
            f"{len(chunks)} chunks ({passage_chunks} passages, {table_chunks} tables, {figure_chunks} figures)",
        )

        # --- Stage: embedding -----------------------------------------------
        set_status(document_id, version, "embedding", "embedding")
        provider = embeddings.get_default_provider()
        log_event(
            document_id,
            version,
            "embedding",
            "started",
            f"Embedding {len(chunks)} chunks with {provider.model_name} "
            f"({'fallback' if embeddings.provider_is_fallback() else 'fastembed'})",
        )
        if chunks:
            with db.tx() as conn:
                conn.execute(
                    "UPDATE chunks SET embedding_model = ?, embedding_version = ? "
                    "WHERE document_id = ? AND version = ?",
                    (provider.model_name, "v1", document_id, version),
                )
        log_event(document_id, version, "embedding", "completed", f"{len(chunks)} chunks embedded")

        # --- Stage: indexing --------------------------------------------------
        set_status(document_id, version, "indexing", "indexing")
        log_event(document_id, version, "indexing", "started", "Upserting into hybrid search index")
        indexed_count = search_index.index_document(document_id, version)
        log_event(document_id, version, "indexing", "completed", f"{indexed_count} vectors indexed")

        # --- Stage: graph_extraction (Phase 6.1) -----------------------------
        # Runs after indexing, not blocking the query-time retrieval path --
        # a GraphRAG extraction failure must never fail document ingestion.
        set_status(document_id, version, "graph_extraction", "graph_extraction")
        log_event(document_id, version, "graph_extraction", "started", "Extracting entities/relationships")
        try:
            graph_stats = graph_extraction.extract_document(document_id, version)
            log_event(
                document_id,
                version,
                "graph_extraction",
                "completed",
                f"{graph_stats.edges_extracted} edges ({graph_stats.extractor_used}): "
                f"{graph_stats.edges_by_predicate}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("graph_extraction failed for %s v%d (non-fatal)", document_id, version)
            log_event(document_id, version, "graph_extraction", "error", str(exc))
            graph_stats = graph_extraction.ExtractionStats()

        # --- Stage: lexicon_mining (Self-Learning Copilot) --------------------
        try:
            from app.services import lexicon_miner

            all_text = " ".join((el.get("text") or "") for el in elements)
            mined_count = lexicon_miner.mine_and_persist_from_document(document_id, all_text, tenant_id)
            if mined_count > 0:
                log_event(document_id, version, "indexing", "lexicon_mined", f"Discovered {mined_count} domain terms")
        except Exception as exc:  # noqa: BLE001
            logger.exception("lexicon mining failed for %s (non-fatal)", document_id)

        manifest = {
            "document_id": document_id,
            "version": version,
            "status": "indexed",
            "parser": {"service": extraction.PARSER_NAME, "version": extraction.PARSER_VERSION},
            "chunking": {
                "strategy": "hierarchical-parent-child",
                "target_tokens": chunking.TARGET_TOKENS,
                "overlap_ratio": chunking.OVERLAP_RATIO,
                "chunk_count": len(chunks),
                "passage_chunks": passage_chunks,
                "table_chunks": table_chunks,
                "figure_chunks": figure_chunks,
            },
            "embedding": {
                "model": provider.model_name,
                "dimensions": provider.dimensions,
                "fallback": embeddings.provider_is_fallback(),
                "version": "v1",
            },
            "search_index": search_index.get_index_manager().name,
            "graph_extraction": {
                "edges_extracted": graph_stats.edges_extracted,
                "edges_by_predicate": graph_stats.edges_by_predicate,
                "extractor_used": graph_stats.extractor_used,
            },
            "multimodal_extraction": {
                "routed": mm_stats.routed,
                "total_elements": mm_stats.total_elements,
                "routed_pages": mm_stats.routed_pages,
                "total_pages": mm_stats.total_pages,
                "routed_page_percentage": mm_stats.routed_page_percentage,
                "extractor_used": mm_stats.extractor_used,
                "reasons": mm_stats.reasons,
            },
            "quality": {
                "page_count": stats.page_count,
                "table_count": stats.table_count,
                "figure_count": stats.figure_count,
                "heading_count": stats.heading_count,
                "ocr_pages": stats.ocr_pages,
                "ocr_confidence": stats.ocr_confidence,
            },
            "generated_at": _now(),
        }
        storage.save_json(derived_dir / "manifest.json", db.dumps(manifest))

        # --- Stage: completed ---------------------------------------------
        set_status(
            document_id,
            version,
            "completed",
            "completed",
            page_count=stats.page_count,
            table_count=stats.table_count,
            figure_count=stats.figure_count,
            heading_count=stats.heading_count,
            ocr_pages=stats.ocr_pages,
            ocr_confidence=stats.ocr_confidence,
            parser=extraction.PARSER_NAME,
            parser_version=extraction.PARSER_VERSION,
            error=None,
        )
        log_event(document_id, version, "completed", "success", "Document indexed and ready")

    except Exception as exc:  # noqa: BLE001
        logger.exception("Pipeline failure for %s v%d (attempt %d)", document_id, version, attempt)
        log_event(document_id, version, "failed", "error", f"attempt {attempt}: {exc}")
        if attempt < MAX_ATTEMPTS:
            log_event(document_id, version, "retrying", "scheduled", f"Retry attempt {attempt + 1}")
            process_document(document_id, version, attempt=attempt + 1)
        else:
            set_status(document_id, version, "failed", "dead_lettered", error=str(exc))
            log_event(document_id, version, "dead_lettered", "failed", "Max retries exhausted")
