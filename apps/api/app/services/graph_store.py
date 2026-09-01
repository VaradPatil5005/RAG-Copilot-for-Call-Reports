"""GraphRAG graph store (Phase 6.1).

Substitutes a dedicated graph database with relational tables
(`graph_nodes`, `graph_edges`) in the existing SQLite DB, per the Phase 6
spec's explicit instruction to avoid a new database dependency unless a
genuinely better lightweight local graph library is already available.
`networkx` is available in this environment and is used *only* as an
in-memory traversal helper for multi-hop queries (`query_connected`) --
it is never the source of truth; SQLite rows are, so every edge always
carries its ACL/classification/source-chunk provenance and survives a
process restart. This mirrors ADR 0003's reasoning for keeping FTS5 +
hnswlib in the same SQLite file rather than adding a new engine.

ACL enforcement here reuses the exact same posture as
`search_index._fetch_chunk_rows` / `search_index.SearchFilters`
(ADR 0006): a chunk-derived edge is authorized only if the requesting
principal set intersects its `acl_principals`, or its `classification`
is "public". Applied here, at the graph retrieval layer itself, before
any evidence reaches generation -- never post-generation, and never a
separate enforcement path from passage retrieval.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import networkx as nx

from app import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_node(node_id: str, tenant_id: str, entity_type: str, name: str) -> None:
    conn = db.get_connection()
    existing = db.row_to_dict(
        conn.execute(
            "SELECT node_id, aliases FROM graph_nodes WHERE node_id = ? AND tenant_id = ?",
            (node_id, tenant_id),
        ).fetchone()
    )
    now = _now()
    if existing is None:
        with db.tx() as tx_conn:
            tx_conn.execute(
                "INSERT INTO graph_nodes (node_id, tenant_id, entity_type, canonical_name, aliases, "
                "created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (node_id, tenant_id, entity_type, name, db.dumps([name]), now, now),
            )
        return

    aliases = db.loads(existing.get("aliases"), [])
    if name not in aliases:
        aliases.append(name)
        with db.tx() as tx_conn:
            tx_conn.execute(
                "UPDATE graph_nodes SET aliases = ?, updated_at = ? WHERE node_id = ? AND tenant_id = ?",
                (db.dumps(aliases), now, node_id, tenant_id),
            )


def upsert_edge(edge, tenant_id: str, acl_principals: list[str], classification: str) -> str:
    """`edge` is a `graph_extraction.EdgeRecord`. Resolves both endpoints
    through `graph_extraction.resolve_alias` (deterministic-first, audited
    fuzzy fallback), upserts both nodes, then inserts the edge row with
    full source provenance -- one row per extracted edge, never
    deduplicated away, since each row is itself a citation."""
    from app.services import graph_extraction  # local import avoids a cycle at module load

    subject_id = graph_extraction.resolve_alias(edge.subject_type, edge.subject_name, tenant_id)
    object_id = graph_extraction.resolve_alias(edge.object_type, edge.object_name, tenant_id)
    upsert_node(subject_id, tenant_id, edge.subject_type, edge.subject_name)
    upsert_node(object_id, tenant_id, edge.object_type, edge.object_name)

    edge_id = f"edge-{uuid.uuid4().hex[:16]}"
    with db.tx() as tx_conn:
        tx_conn.execute(
            "INSERT INTO graph_edges (edge_id, tenant_id, subject_node_id, predicate, object_node_id, "
            "confidence, valid_from, source_document_id, source_version, source_chunk_id, source_page, "
            "extractor, acl_principals, classification, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                edge_id,
                tenant_id,
                subject_id,
                edge.predicate,
                object_id,
                edge.confidence,
                edge.valid_from,
                edge.source_document_id,
                edge.source_version,
                edge.source_chunk_id,
                edge.source_page,
                edge.extractor,
                db.dumps(acl_principals or []),
                classification,
                _now(),
            ),
        )
    return edge_id


@dataclass
class GraphQueryResult:
    nodes: list[dict] = field(default_factory=list)
    edges: list[dict] = field(default_factory=list)
    # One list of source-chunk citations per returned edge (by edge_id) --
    # every graph-sourced claim traces back to real evidence, per the
    # Phase 6 exit criteria.
    citations_by_edge: dict[str, dict] = field(default_factory=dict)


def _edge_citation(row: dict) -> dict:
    return {
        "document_id": row["source_document_id"],
        "version": row["source_version"],
        "page": row.get("source_page"),
        "chunk_id": row["source_chunk_id"],
    }


def query_by_predicate(
    predicate: str,
    tenant_id: str = "tenant-a",
    principals: list[str] | None = None,
    limit: int = 200,
) -> GraphQueryResult:
    """Direct predicate lookup, e.g. all MENTIONED_COMPETITOR edges --
    the query pattern behind "which customers mention the same
    competitor". Phase 6.3: the ACL predicate is part of this SQL query
    (`db.acl_predicate_sql`), the same real-predicate chokepoint passage
    retrieval uses -- not a Python filter applied after fetching every
    edge row."""
    conn = db.get_connection()
    sql = "SELECT * FROM graph_edges WHERE predicate = ? AND tenant_id = ?"
    params: list = [predicate, tenant_id]
    acl_sql, acl_params = db.acl_predicate_sql(principals)
    if acl_sql:
        sql += f" AND {acl_sql}"
        params.extend(acl_params)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = db.rows_to_list(conn.execute(sql, params).fetchall())
    return _assemble_result(rows, tenant_id)  # already ACL-filtered in SQL above


def query_connected(
    node_id: str,
    tenant_id: str = "tenant-a",
    principals: list[str] | None = None,
    max_hops: int = 2,
) -> GraphQueryResult:
    """Multi-hop traversal from a given node, e.g. "what connects to this
    account across other accounts". Builds an in-memory `networkx` graph
    from the *already-ACL-filtered* edge set (never the other way around --
    filtering happens before traversal, not after, so an unauthorized edge
    can never even become a traversal hop)."""
    conn = db.get_connection()
    conn = db.get_connection()
    sql = "SELECT * FROM graph_edges WHERE tenant_id = ?"
    params: list = [tenant_id]
    acl_sql, acl_params = db.acl_predicate_sql(principals)
    if acl_sql:
        sql += f" AND {acl_sql}"
        params.extend(acl_params)
    authorized_rows = db.rows_to_list(conn.execute(sql, params).fetchall())

    g = nx.MultiDiGraph()
    for r in authorized_rows:
        g.add_edge(r["subject_node_id"], r["object_node_id"], edge_row=r)

    if node_id not in g:
        return GraphQueryResult()

    reachable = nx.single_source_shortest_path_length(g.to_undirected(), node_id, cutoff=max_hops)
    relevant_rows = [
        r
        for r in authorized_rows
        if r["subject_node_id"] in reachable and r["object_node_id"] in reachable
    ]
    return _assemble_result(relevant_rows, tenant_id)


def customers_sharing_competitor(
    tenant_id: str = "tenant-a", principals: list[str] | None = None
) -> GraphQueryResult:
    """The blueprint's flagship cross-document example: group
    MENTIONED_COMPETITOR edges by competitor, keep only competitors
    connected to >= 2 distinct customers."""
    result = query_by_predicate("MENTIONED_COMPETITOR", tenant_id, principals, limit=2000)
    by_object: dict[str, set[str]] = {}
    for e in result.edges:
        by_object.setdefault(e["object_node_id"], set()).add(e["subject_node_id"])
    shared_objects = {obj for obj, subs in by_object.items() if len(subs) >= 2}
    filtered_edges = [e for e in result.edges if e["object_node_id"] in shared_objects]
    node_ids = {e["subject_node_id"] for e in filtered_edges} | {e["object_node_id"] for e in filtered_edges}
    filtered_nodes = [n for n in result.nodes if n["node_id"] in node_ids]
    return GraphQueryResult(
        nodes=filtered_nodes,
        edges=filtered_edges,
        citations_by_edge={eid: c for eid, c in result.citations_by_edge.items() if any(e["edge_id"] == eid for e in filtered_edges)},
    )


def _assemble_result(rows: list[dict], tenant_id: str) -> GraphQueryResult:
    """Assembles a result from already-ACL-filtered edge rows (every
    caller applies `db.acl_predicate_sql` in its own SQL query before
    reaching here) -- this function does no further authorization
    filtering itself, it only resolves node metadata and citations."""
    conn = db.get_connection()
    node_ids = {r["subject_node_id"] for r in rows} | {r["object_node_id"] for r in rows}
    nodes = []
    if node_ids:
        placeholders = ",".join("?" for _ in node_ids)
        nodes = db.rows_to_list(
            conn.execute(
                f"SELECT * FROM graph_nodes WHERE node_id IN ({placeholders}) AND tenant_id = ?",
                (*node_ids, tenant_id),
            ).fetchall()
        )
        for n in nodes:
            n["aliases"] = db.loads(n.get("aliases"), [])

    edges = []
    citations_by_edge = {}
    for r in rows:
        edges.append(
            {
                "edge_id": r["edge_id"],
                "subject_node_id": r["subject_node_id"],
                "predicate": r["predicate"],
                "object_node_id": r["object_node_id"],
                "confidence": r["confidence"],
                "extractor": r["extractor"],
            }
        )
        citations_by_edge[r["edge_id"]] = _edge_citation(r)

    return GraphQueryResult(nodes=nodes, edges=edges, citations_by_edge=citations_by_edge)
