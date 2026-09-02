"""Local metadata store — substitutes Azure Cosmos DB / Azure SQL (Phase 2 scope).

SQLite is used for local-dev velocity. All access goes through this module so
swapping to Cosmos DB / Azure SQL later touches only this file.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "metadata.sqlite3"

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def get_connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL;")
        _conn.execute("PRAGMA foreign_keys=ON;")
    return _conn


def close_connection() -> None:
    """Closes and releases the cached connection singleton.

    Needed on app shutdown (see `main.py`'s lifespan) and before a test
    fixture deletes the `data/` directory out from under a live process
    -- SQLite on POSIX lets you unlink/rmtree a file that's still open
    (the handle stays valid until closed), but Windows locks the file and
    `shutil.rmtree` raises `PermissionError: WinError 32` if anything in
    the *same* process (or another process, e.g. a `uvicorn` instance
    left running in another terminal) still holds it open. Explicitly
    closing here is what makes teardown/re-ingest actually portable
    across platforms rather than only working by POSIX accident."""
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """Serialize writes — SQLite + a threadpool of workers needs this."""
    conn = get_connection()
    with _lock:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    document_id     TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    filename        TEXT NOT NULL,
    customer_name   TEXT,
    account_owner   TEXT,
    meeting_date    TEXT,
    classification  TEXT DEFAULT 'internal',
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_versions (
    document_id     TEXT NOT NULL,
    version         INTEGER NOT NULL,
    sha256          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued',
    stage           TEXT NOT NULL DEFAULT 'queued',
    error           TEXT,
    file_path       TEXT,
    size_bytes      INTEGER,
    page_count      INTEGER,
    table_count     INTEGER DEFAULT 0,
    figure_count    INTEGER DEFAULT 0,
    heading_count   INTEGER DEFAULT 0,
    ocr_pages       INTEGER DEFAULT 0,
    ocr_confidence  REAL,
    parser          TEXT,
    parser_version  TEXT,
    duplicate_of    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (document_id, version)
);

CREATE TABLE IF NOT EXISTS processing_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id  TEXT NOT NULL,
    version      INTEGER NOT NULL,
    stage        TEXT NOT NULL,
    status       TEXT NOT NULL,
    message      TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS elements (
    element_id     TEXT PRIMARY KEY,
    document_id    TEXT NOT NULL,
    version        INTEGER NOT NULL,
    page_number    INTEGER NOT NULL,
    element_type   TEXT NOT NULL,
    heading_level  INTEGER,
    section_path   TEXT,
    text           TEXT,
    markdown       TEXT,
    bbox           TEXT,
    confidence     REAL,
    table_json     TEXT,
    figure_path    TEXT,
    ocr            INTEGER DEFAULT 0,
    include_in_search INTEGER DEFAULT 1,
    description    TEXT
);

CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_events_doc ON processing_events(document_id, version);
CREATE INDEX IF NOT EXISTS idx_elements_doc ON elements(document_id, version);
CREATE INDEX IF NOT EXISTS idx_elements_type ON elements(document_id, version, element_type);
CREATE INDEX IF NOT EXISTS idx_versions_sha ON document_versions(tenant_id_sha);

-- Phase 3: hierarchical chunks -- retrieval-ready passages/tables/figures
-- built from `elements`. See services/chunking.py.
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id           TEXT PRIMARY KEY,
    document_id        TEXT NOT NULL,
    version             INTEGER NOT NULL,
    tenant_id           TEXT NOT NULL,
    parent_section_id   TEXT,
    chunk_type          TEXT NOT NULL,      -- 'passage' | 'table' | 'figure'
    section_path        TEXT,               -- JSON array, same convention as elements
    page_number          INTEGER,
    customer_name        TEXT,
    account_owner         TEXT,
    meeting_date          TEXT,
    content              TEXT NOT NULL,      -- contextualized text used for embedding + BM25
    raw_text              TEXT,               -- original text without the prepended context
    table_json            TEXT,
    table_id               TEXT,
    token_count            INTEGER,
    content_hash            TEXT,
    embedding_model          TEXT,
    embedding_version        TEXT,
    -- acl_principals / classification: populated at ingestion (Phase 5)
    -- and enforced as a real SQL predicate at every retrieval stage as of
    -- Phase 6.3 -- see db.acl_predicate_sql and services/search_index.py.
    acl_principals            TEXT,
    classification             TEXT,
    -- pii_flags: PII *categories* detected in this chunk's raw_text
    -- (Phase 6.5, services/pii.py) -- a compliance/inventory signal only.
    -- Content itself is never redacted here (see pii.py's module
    -- docstring for why): this column records e.g. '["email","phone"]'
    -- so a real deployment's governance process has something to act on.
    pii_flags                   TEXT,
    created_at                 TEXT NOT NULL,
    updated_at                 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id, version);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(document_id, version, chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_parent ON chunks(parent_section_id);
CREATE INDEX IF NOT EXISTS idx_chunks_table ON chunks(table_id);

-- Lexical index -- local substitute for Azure AI Search's BM25 field.
-- Kept in the same DB file (see ADR 0003) via SQLite FTS5, content-synced
-- to `chunks` through the triggers below rather than a separate index file.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    content,
    content='chunks',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, chunk_id, content) VALUES (new.rowid, new.chunk_id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, content) VALUES ('delete', old.rowid, old.chunk_id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, content) VALUES ('delete', old.rowid, old.chunk_id, old.content);
    INSERT INTO chunks_fts(rowid, chunk_id, content) VALUES (new.rowid, new.chunk_id, new.content);
END;

-- Tracks which on-disk vector index version is currently active, mirroring
-- the blueprint's blue/green indexing concept even at local-dev scale.
CREATE TABLE IF NOT EXISTS search_index_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Phase 4: one row per Copilot exchange -- query, retrieved evidence,
-- generated answer, citation validation results, model, timing. Feeds
-- Phase 6 evaluation directly (see Phase 4 build prompt section 6/10).
CREATE TABLE IF NOT EXISTS chat_traces (
    trace_id            TEXT PRIMARY KEY,
    conversation_id      TEXT,
    tenant_id             TEXT NOT NULL DEFAULT 'tenant-a',
    query                  TEXT NOT NULL,
    intent                  TEXT,
    retrieved_chunk_ids      TEXT,   -- JSON array
    answer_json               TEXT NOT NULL,
    citation_validation        TEXT,   -- JSON: {"total","valid","stripped","existence_check_failed","support_check_failed"}
    model_name                  TEXT,
    provider_is_fallback         INTEGER DEFAULT 0,
    json_retry_used               INTEGER DEFAULT 0,
    confidence                     TEXT,
    abstained                       INTEGER,
    latency_ms                       INTEGER,
    -- Phase 6.6: real per-call token usage (never estimated) from the
    -- provider's own response -- see generation.py's GenerationResult.usage.
    prompt_tokens                     INTEGER,
    completion_tokens                  INTEGER,
    total_tokens                        INTEGER,
    created_at                        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_traces_conv ON chat_traces(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_traces_created ON chat_traces(created_at);

-- Phase 6.1: GraphRAG layer. Relational graph tables in the same SQLite DB
-- rather than a new database dependency (see services/graph_store.py and
-- ADR 0007). One row per extracted edge -- never deduplicated away, since
-- each row is itself a citation back to a real chunk.
CREATE TABLE IF NOT EXISTS graph_nodes (
    node_id         TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    canonical_name  TEXT NOT NULL,
    aliases         TEXT,   -- JSON array of raw name variants seen
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (node_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS graph_edges (
    edge_id             TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    subject_node_id     TEXT NOT NULL,
    predicate           TEXT NOT NULL,
    object_node_id      TEXT NOT NULL,
    confidence          REAL,
    valid_from          TEXT,
    source_document_id  TEXT NOT NULL,
    source_version      INTEGER NOT NULL,
    source_chunk_id     TEXT NOT NULL,
    source_page         INTEGER,
    extractor           TEXT NOT NULL,   -- 'llm' | 'rule_based' | 'deterministic'
    acl_principals      TEXT,            -- JSON, copied from source chunk at extraction time
    classification       TEXT,
    created_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_subject ON graph_edges(subject_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_object ON graph_edges(object_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_predicate ON graph_edges(predicate, tenant_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_doc ON graph_edges(source_document_id, source_version);

-- Audit trail for alias-resolution decisions above FUZZY_AUDIT_THRESHOLD --
-- see graph_extraction.resolve_alias. Never a silent auto-merge.
CREATE TABLE IF NOT EXISTS graph_alias_audit (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type      TEXT NOT NULL,
    candidate_name   TEXT NOT NULL,
    matched_node_id  TEXT,
    similarity       REAL,
    decision         TEXT NOT NULL,   -- 'merged' | 'kept_separate'
    created_at       TEXT NOT NULL
);

-- Phase 6.3: structured access audit trail -- every retrieval-touching
-- request logs the resolved identity, the ACL filter actually built from
-- it, and the evidence chunk_ids actually returned, so any given answer's
-- authorization decision can be reconstructed later. Alongside (not
-- replacing) chat_traces, which already captures the richer Copilot-
-- specific trace for /chat itself.
CREATE TABLE IF NOT EXISTS access_audit_log (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id             TEXT,
    endpoint             TEXT NOT NULL,
    identity_sub         TEXT,
    tenant_id            TEXT,
    principals           TEXT,   -- JSON, null = unscoped internal caller
    acl_filter_summary   TEXT,
    query                TEXT,
    evidence_chunk_ids   TEXT,   -- JSON
    evidence_count       INTEGER,
    created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_audit_created ON access_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_access_audit_tenant ON access_audit_log(tenant_id);

-- Phase 6.6: persisted evaluation runs, so the Admin panel can surface the
-- latest full-benchmark result directly (per the spec's explicit
-- requirement) without re-running the expensive benchmark on every page
-- load. One row per /evaluation/run-full call.
CREATE TABLE IF NOT EXISTS evaluation_runs (
    run_id       TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,   -- 'run_full' (room for other kinds later)
    n_queries    INTEGER,
    report_json  TEXT NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_created ON evaluation_runs(created_at);

-- Phase A (feature/decision-intelligence-layer, additive): one row per
-- Query Router classification. Deliberately a *separate* table rather
-- than new columns on chat_traces -- joins cleanly on trace_id for
-- Phase C observability without touching chat_traces' existing column
-- semantics or requiring an ALTER TABLE migration on existing DBs. See
-- app/routing/query_router.py.
CREATE TABLE IF NOT EXISTS query_router_decisions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id         TEXT,
    conversation_id  TEXT,
    tenant_id        TEXT,
    query            TEXT NOT NULL,
    category         TEXT NOT NULL,   -- lookup | comparison | trend | multi_hop | graph_relationship
    method           TEXT NOT NULL,   -- heuristic | llm_fallback | heuristic_default
    confidence       TEXT NOT NULL,   -- high | medium | low
    signals_json     TEXT,            -- JSON: heuristic scores + matched terms
    suggested_paths  TEXT,            -- JSON array of existing retrieval path names
    created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_router_trace ON query_router_decisions(trace_id);
CREATE INDEX IF NOT EXISTS idx_query_router_created ON query_router_decisions(created_at);
"""

# tenant_id + sha live together for dedupe lookups; SQLite has no composite
# generated columns pre-3.31 in some builds, so we just index sha256 instead.
SCHEMA = SCHEMA.replace(
    "CREATE INDEX IF NOT EXISTS idx_versions_sha ON document_versions(tenant_id_sha);",
    "CREATE INDEX IF NOT EXISTS idx_versions_sha ON document_versions(sha256);",
)


def init_db() -> None:
    conn = get_connection()
    conn.executescript(SCHEMA)
    conn.commit()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]


def dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def acl_predicate_sql(principals: list[str] | None, table_alias: str = "") -> tuple[str, list[Any]]:
    """Phase 6.3: a genuine SQL WHERE predicate (SQLite's built-in JSON1
    `json_each`) for ACL enforcement, so an unauthorized row is excluded
    by the query engine itself and never fetched into a Python dict at
    all -- replacing the Phase 5 pattern of fetching every row then
    checking `set(acl) & set(principals)` in Python. Shared by
    `search_index.py` (passage/vector retrieval) and `graph_store.py`
    (GraphRAG retrieval) so every retrieval path enforces ACLs the same
    way, at the same layer.

    `principals=None` means no ACL enforcement (an internal/system caller
    already scoped some other way, e.g. the evaluation harness by
    tenant_id) -- returns an empty predicate. `principals=[]` means an
    authenticated caller with no grants -- matches nothing but public
    content, by design (an empty SQL `IN ()` list is invalid, so this
    substitutes an always-false placeholder rather than omitting the
    clause).
    """
    if principals is None:
        return "", []
    prefix = f"{table_alias}." if table_alias else ""
    if not principals:
        return f"lower({prefix}classification) = 'public'", []
    placeholders = ",".join("?" for _ in principals)
    predicate = (
        f"(lower({prefix}classification) = 'public' OR EXISTS ("
        f"SELECT 1 FROM json_each({prefix}acl_principals) AS je WHERE je.value IN ({placeholders})))"
    )
    return predicate, list(principals)
