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

      <div className="mx-8 space-y-5">
        <div className="flex flex-wrap items-center gap-2.5">
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
                "rounded-xl border px-3.5 py-2 text-[12px] font-medium transition-all duration-200",
                mode === opt.key
                  ? "border-evidence/50 bg-evidence/15 text-evidence shadow-[0_0_12px_rgba(79,209,197,0.2)]"
                  : "border-white/10 bg-surface/70 text-text-muted hover:bg-elevated hover:text-text"
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
              className="rounded-xl border border-white/10 bg-surface/80 px-3 py-2 text-[12px] text-text outline-none focus:border-evidence/50"
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
                className="w-56 rounded-xl border border-white/10 bg-surface/80 py-2 pl-8 pr-3 text-[12px] text-text placeholder:text-text-faint outline-none focus:border-evidence/50"
              />
            </div>
          )}

          <button
            onClick={run}
            disabled={loading || (mode === "connected" && !nodeId.trim())}
            className="ml-auto flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-amber-500 hover:brightness-110 px-4 py-2 text-[12px] font-bold text-bg shadow-[0_0_15px_rgba(240,168,87,0.25)] transition-all disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
            Run query
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-400" role="alert">
            {error}
          </div>
        )}

        {ran && !error && edges.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 bg-elevated/20 px-4 py-10 text-center text-[13px] text-text-muted">
            No graph edges matched this query (or none are authorized for your identity).
          </div>
        )}

        {Object.entries(grouped).map(([pred, byObject]) => (
          <div key={pred} className="rounded-2xl border border-white/8 bg-surface/70 backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] overflow-hidden">
            <div className="border-b border-white/8 bg-surface/40 px-5 py-3 text-[11px] font-mono font-bold uppercase tracking-wider text-text-muted flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_6px_rgba(79,209,197,0.8)]" />
              {PREDICATE_LABEL[pred] ?? pred}
            </div>
            <div className="divide-y divide-white/6">
              {Object.entries(byObject).map(([objectId, objEdges]) => (
                <div key={objectId} className="px-5 py-3.5">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-text">
                    <span className="rounded-md bg-evidence/15 border border-evidence/25 px-2 py-0.5 font-mono text-[10px] uppercase text-evidence font-bold">
                      {nodesById[objectId]?.entity_type ?? "entity"}
                    </span>
                    {nodeLabel(objectId, nodesById)}
                    <span className="font-mono text-[11px] font-normal text-text-faint">
                      ({objEdges.length} connection{objEdges.length === 1 ? "" : "s"})
                    </span>
                  </div>
                  <div className="space-y-2 pl-2">
                    {objEdges.map((e) => {
                      const citation = citations[e.edge_id];
                      return (
                        <div
                          key={e.edge_id}
                          className="flex items-center gap-2.5 text-[12px] text-text-muted hover:text-text transition-colors"
                        >
                          <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" />
                          <span className="text-text font-medium">{nodeLabel(e.subject_node_id, nodesById)}</span>
                          {citation && (
                            <span
                              className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/8 bg-elevated-2/50 px-2 py-0.5 font-mono text-[10px] text-text-faint hover:text-evidence transition-colors"
                              title={`Source: ${citation.document_id}${citation.page ? ` p.${citation.page}` : ""}`}
                            >
                              <FileText className="h-3 w-3 text-evidence" />
                              {citation.document_id}
                              {citation.page ? ` · p.${citation.page}` : ""}
                            </span>
                          )}
                          <span className="rounded-md bg-elevated px-2 py-0.5 font-mono text-[10px] text-text-faint border border-white/5">
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
