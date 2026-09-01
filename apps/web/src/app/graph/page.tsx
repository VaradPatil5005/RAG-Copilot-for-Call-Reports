"use client";

import { useCallback, useMemo, useState } from "react";
import { Share2, Loader2, Search as SearchIcon, FileText, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { queryGraph, type GraphNode, type GraphEdge, type GraphCitation } from "@/lib/api";

// NOTE: this is a 2D card/list relationship explorer, not a force-directed
// node-link canvas -- the Phase 6.1 spec explicitly calls a full 3D graph
// visualization a stretch goal, not a blocker, and a list view keeps every
// edge's source citation directly visible and clickable, which a dense
// node-link diagram tends to bury. Grouping by predicate/object below is
// the same shape as the blueprint's own "customers sharing a competitor"
// example query.

const PREDICATE_LABEL: Record<string, string> = {
  MENTIONED_COMPETITOR: "mentioned competitor",
  HAS_RISK: "has risk",
  HAS_COMMITMENT: "has commitment",
  OWNS: "owns action",
  USES_PRODUCT: "uses product",
  DESCRIBES: "describes",
  SUPERSEDES: "supersedes",
  OPENED_ON: "opened on",
  DUE_ON: "due on",
};

function nodeLabel(nodeId: string, nodes: Record<string, GraphNode>): string {
  return nodes[nodeId]?.canonical_name ?? nodeId;
}

export default function GraphPage() {
  const [mode, setMode] = useState<"shared_competitor" | "predicate" | "connected">("shared_competitor");
  const [predicate, setPredicate] = useState("MENTIONED_COMPETITOR");
  const [nodeId, setNodeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [citations, setCitations] = useState<Record<string, GraphCitation>>({});
  const [ran, setRan] = useState(false);

  const nodesById = useMemo(() => {
    const map: Record<string, GraphNode> = {};
    for (const n of nodes) map[n.node_id] = n;
    return map;
  }, [nodes]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params =
        mode === "shared_competitor"
          ? { question: "Which customers mention the same competitor?" }
          : mode === "connected"
            ? { node_id: nodeId.trim() }
            : { predicate };
      const res = await queryGraph(params);
      setNodes(res.nodes);
      setEdges(res.edges);
      setCitations(res.citations);
      setRan(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Graph query failed");
      setNodes([]);
      setEdges([]);
      setCitations({});
    } finally {
      setLoading(false);
    }
  }, [mode, predicate, nodeId]);

  // Group edges by predicate then by object, mirroring the blueprint's own
  // "group MENTIONED_COMPETITOR edges by competitor" query pattern.
  const grouped = useMemo(() => {
    const byPredicate: Record<string, Record<string, GraphEdge[]>> = {};
    for (const e of edges) {
      byPredicate[e.predicate] ??= {};
      byPredicate[e.predicate][e.object_node_id] ??= [];
      byPredicate[e.predicate][e.object_node_id].push(e);
    }
    return byPredicate;
  }, [edges]);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Knowledge graph"
        title="Knowledge Graph"
        description="Explore relationships between customers, opportunities, products, competitors, risks, and actions — every claim traceable to source evidence."
      />

      <div className="mx-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { key: "shared_competitor", label: "Customers sharing a competitor" },
              { key: "predicate", label: "By relationship type" },
              { key: "connected", label: "Connected to a node" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setMode(opt.key)}
              aria-pressed={mode === opt.key}
              className={cn(
                "rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
                mode === opt.key
                  ? "border-primary-dim/60 bg-primary-dim/20 text-primary"
                  : "border-border-subtle text-text-muted hover:bg-elevated"
              )}
            >
              {opt.label}
            </button>
          ))}

          {mode === "predicate" && (
            <select
              value={predicate}
              onChange={(e) => setPredicate(e.target.value)}
              aria-label="Relationship type"
              className="rounded-lg border border-border-subtle bg-elevated/60 px-3 py-2 text-[12px] text-text outline-none"
            >
              {Object.keys(PREDICATE_LABEL).map((p) => (
                <option key={p} value={p}>
                  {PREDICATE_LABEL[p]}
                </option>
              ))}
            </select>
          )}

          {mode === "connected" && (
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <input
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                placeholder="e.g. customer:contoso"
                aria-label="Node ID to explore connections from"
                className="w-56 rounded-lg border border-border-subtle bg-elevated/60 py-2 pl-8 pr-3 text-[12px] text-text placeholder:text-text-faint outline-none"
              />
            </div>
          )}

          <button
            onClick={run}
            disabled={loading || (mode === "connected" && !nodeId.trim())}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-medium text-white transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
            Run query
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400" role="alert">
            {error}
          </div>
        )}

        {ran && !error && edges.length === 0 && (
          <div className="rounded-lg border border-border-subtle bg-elevated/40 px-4 py-6 text-center text-[13px] text-text-muted">
            No graph edges matched this query (or none are authorized for your identity).
          </div>
        )}

        {Object.entries(grouped).map(([pred, byObject]) => (
          <div key={pred} className="rounded-lg border border-border-subtle bg-elevated/40">
            <div className="border-b border-border-subtle px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
              {PREDICATE_LABEL[pred] ?? pred}
            </div>
            <div className="divide-y divide-border-subtle">
              {Object.entries(byObject).map(([objectId, objEdges]) => (
                <div key={objectId} className="px-4 py-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-text">
                    <span className="rounded bg-primary-dim/20 px-1.5 py-0.5 text-[10px] uppercase text-primary">
                      {nodesById[objectId]?.entity_type ?? "entity"}
                    </span>
                    {nodeLabel(objectId, nodesById)}
                    <span className="text-[11px] font-normal text-text-faint">
                      ({objEdges.length} connection{objEdges.length === 1 ? "" : "s"})
                    </span>
                  </div>
                  <div className="space-y-1.5 pl-1">
                    {objEdges.map((e) => {
                      const citation = citations[e.edge_id];
                      return (
                        <div
                          key={e.edge_id}
                          className="flex items-center gap-2 text-[12px] text-text-muted"
                        >
                          <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" />
                          <span className="text-text">{nodeLabel(e.subject_node_id, nodesById)}</span>
                          {citation && (
                            <span
                              className="ml-auto flex items-center gap-1 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-faint"
                              title={`Source: ${citation.document_id}${citation.page ? ` p.${citation.page}` : ""}`}
                            >
                              <FileText className="h-3 w-3" />
                              {citation.document_id}
                              {citation.page ? ` · p.${citation.page}` : ""}
                            </span>
                          )}
                          <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-text-faint">
                            {e.extractor}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
