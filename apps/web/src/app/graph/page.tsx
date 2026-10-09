"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Share2,
  Loader2,
  Search as SearchIcon,
  FileText,
  ChevronRight,
  Network,
  List,
  Sparkles,
  Columns,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { queryGraph, type GraphNode, type GraphEdge, type GraphCitation } from "@/lib/api";
import { InteractiveKnowledgeGraph } from "@/components/graph/interactive-knowledge-graph";
import { DocumentViewerModal } from "@/components/documents/document-viewer-modal";

const PREDICATE_OPTIONS = [
  { key: "ALL", label: "All Relationships", color: "#EE6A3C" },
  { key: "HAS_RISK", label: "Has Risk", color: "#EF6B57" },
  { key: "MENTIONED_COMPETITOR", label: "Mentioned Competitor", color: "#D9A441" },
  { key: "USES_PRODUCT", label: "Uses Product", color: "#A7798A" },
  { key: "HAS_COMMITMENT", label: "Has Commitment", color: "#7F95A6" },
  { key: "DESCRIBES", label: "Describes", color: "#8E8273" },
  { key: "OWNS", label: "Owns Action", color: "#C9A46A" },
];

const PREDICATE_LABEL: Record<string, string> = {
  ALL: "all relationships",
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
  const [mode, setMode] = useState<"shared_competitor" | "predicate" | "connected">("predicate");
  const [predicate, setPredicate] = useState("HAS_RISK");
  const [nodeId, setNodeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [citations, setCitations] = useState<Record<string, GraphCitation>>({});
  const [ran, setRan] = useState(false);
  const [viewMode, setViewMode] = useState<"graph" | "split" | "list">("graph");

  // Document modal viewer state
  const [viewerDoc, setViewerDoc] = useState<{ documentId: string; page?: number } | null>(null);

  const nodesById = useMemo(() => {
    const map: Record<string, GraphNode> = {};
    for (const n of nodes) map[n.node_id] = n;
    return map;
  }, [nodes]);

  const executeQuery = useCallback(
    async (
      overrideMode?: "shared_competitor" | "predicate" | "connected",
      overridePredicate?: string,
      overrideNodeId?: string
    ) => {
      const activeMode = overrideMode || mode;
      const activePredicate = overridePredicate !== undefined ? overridePredicate : predicate;
      const activeNodeId = overrideNodeId !== undefined ? overrideNodeId : nodeId;

      setLoading(true);
      setError(null);
      try {
        const params =
          activeMode === "shared_competitor"
            ? { question: "Which customers mention the same competitor?" }
            : activeMode === "connected"
            ? { node_id: activeNodeId.trim() }
            : { predicate: activePredicate };

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
    },
    [mode, predicate, nodeId]
  );

  // Auto-run on initial load so the user sees a rich graph right away
  useEffect(() => {
    executeQuery("predicate", "HAS_RISK");
  }, []);

  // Quick switch of predicate with instant query execution
  const handlePredicateChange = (p: string) => {
    setMode("predicate");
    setPredicate(p);
    executeQuery("predicate", p);
  };

  // Group edges by predicate then by object for evidence list view
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
    <div className="pb-16 min-h-screen">
      {/* Full Document Viewer Modal */}
      {viewerDoc && (
        <DocumentViewerModal
          documentId={viewerDoc.documentId}
          initialPage={viewerDoc.page}
          onClose={() => setViewerDoc(null)}
        />
      )}

      <PageHeader
        eyebrow="Financial Knowledge Network"
        title="Knowledge Graph"
        description="Interactive GraphRAG entity-relationship network visualizer. Explore cross-document connections between customers, covenants, risks, and executives."
      />

      <div className="mx-4 lg:mx-8 space-y-5">
        {/* Top Control Bar & Mode Pills */}
        <div className="flex flex-col gap-3.5 rounded-2xl border border-white/10 bg-[#141312]/85 backdrop-blur-xl p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Primary Query Mode Toggles */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  setMode("predicate");
                  executeQuery("predicate", predicate);
                }}
                className={cn(
                  "rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 cursor-pointer",
                  mode === "predicate"
                    ? "border-evidence/60 bg-evidence/15 text-evidence"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.08] hover:text-white"
                )}
              >
                By Relationship Type
              </button>

              <button
                onClick={() => {
                  setMode("shared_competitor");
                  executeQuery("shared_competitor");
                }}
                className={cn(
                  "rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 cursor-pointer",
                  mode === "shared_competitor"
                    ? "border-evidence/60 bg-evidence/15 text-evidence"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.08] hover:text-white"
                )}
              >
                Customers Sharing a Competitor
              </button>

              <button
                onClick={() => setMode("connected")}
                className={cn(
                  "rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 cursor-pointer",
                  mode === "connected"
                    ? "border-evidence/60 bg-evidence/15 text-evidence"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.08] hover:text-white"
                )}
              >
                Connected to a Node
              </button>
            </div>

            {/* View Mode Switcher (Graph, Split, List) */}
            <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.04] p-1">
              <button
                onClick={() => setViewMode("graph")}
                title="Visual Graph"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                  viewMode === "graph"
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                <Network className="h-3.5 w-3.5 text-primary" />
                <span>Interactive Graph</span>
              </button>

              <button
                onClick={() => setViewMode("split")}
                title="Split View"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                  viewMode === "split"
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                <Columns className="h-3.5 w-3.5" />
                <span>Split View</span>
              </button>

              <button
                onClick={() => setViewMode("list")}
                title="Evidence Statements List"
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                  viewMode === "list"
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-zinc-400 hover:text-white"
                )}
              >
                <List className="h-3.5 w-3.5" />
                <span>Statements</span>
              </button>
            </div>
          </div>

          {/* Quick Relationship Filters Bar */}
          {mode === "predicate" && (
            <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider shrink-0 font-semibold">
                Filter:
              </span>
              <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                {PREDICATE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => handlePredicateChange(opt.key)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all duration-150 cursor-pointer shrink-0 border",
                      predicate === opt.key
                        ? "bg-primary/20 text-white border-primary/50 font-bold"
                        : "bg-white/[0.03] text-zinc-400 border-white/[0.08] hover:bg-white/[0.08] hover:text-white"
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: opt.color }}
                    />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Connected Node Input Search */}
          {mode === "connected" && (
            <div className="pt-2 border-t border-white/[0.06] flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && nodeId.trim()) {
                      executeQuery("connected", undefined, nodeId);
                    }
                  }}
                  placeholder="e.g. customer:globex, risk:budget-risk, subject:project"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-evidence/60"
                />
              </div>
              <button
                onClick={() => executeQuery("connected", undefined, nodeId)}
                disabled={loading || !nodeId.trim()}
                className="flex items-center gap-2 rounded-xl bg-brand-fill hover:bg-brand-press px-4 py-2 text-xs font-bold text-paper transition-all disabled:opacity-40 cursor-pointer"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                Explore Subgraph
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => executeQuery()}
              className="text-white hover:underline text-[11px] font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {/* Dynamic Visual Graph & Statements Layout */}
        <div className="space-y-6">
          {/* Visual Graph View */}
          {(viewMode === "graph" || viewMode === "split") && (
            <div className="relative">
              <InteractiveKnowledgeGraph
                nodes={nodes}
                edges={edges}
                citations={citations}
                selectedPredicate={predicate}
                onOpenDocument={(docId, page) => setViewerDoc({ documentId: docId, page })}
                className={cn(viewMode === "split" ? "h-[500px]" : "h-[640px]")}
              />
            </div>
          )}

          {/* Statements / Evidence List View */}
          {(viewMode === "list" || viewMode === "split") && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="font-display text-sm font-medium text-white tracking-tight flex items-center gap-2">
                  <List className="h-4 w-4 text-primary" />
                  <span>Traceable Evidence Statements ({edges.length} connections)</span>
                </h3>
              </div>

              {ran && !loading && edges.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center text-xs text-zinc-400">
                  No relationships found matching this predicate in your authorized documents.
                </div>
              )}

              {Object.entries(grouped).map(([pred, byObject]) => (
                <div
                  key={pred}
                  className="rounded-2xl border border-white/10 bg-[#141312]/80 backdrop-blur-xl overflow-hidden shadow-lg"
                >
                  <div className="border-b border-white/10 bg-white/[0.03] px-5 py-3 text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-evidence" />
                      <span>{PREDICATE_LABEL[pred] ?? pred.replace(/_/g, " ")}</span>
                    </div>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {Object.values(byObject).flat().length} edges
                    </span>
                  </div>

                  <div className="divide-y divide-white/[0.06]">
                    {Object.entries(byObject).map(([objectId, objEdges]) => (
                      <div key={objectId} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                        <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-white">
                          <span className="rounded-md bg-evidence/15 border border-evidence/30 px-2 py-0.5 font-mono text-[10px] uppercase text-evidence font-bold">
                            {nodesById[objectId]?.entity_type || "Entity"}
                          </span>
                          <span>{nodeLabel(objectId, nodesById)}</span>
                          <span className="font-mono text-xs font-normal text-zinc-500">
                            ({objEdges.length} connection{objEdges.length === 1 ? "" : "s"})
                          </span>
                        </div>

                        <div className="space-y-2 pl-3">
                          {objEdges.map((e) => {
                            const citation = citations[e.edge_id];
                            return (
                              <div
                                key={e.edge_id}
                                className="flex flex-wrap items-center gap-2.5 text-xs text-zinc-300"
                              >
                                <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
                                <span className="font-semibold text-white">
                                  {nodeLabel(e.subject_node_id, nodesById)}
                                </span>
                                <span className="rounded bg-primary/10 border border-primary/25 px-2 py-0.2 font-mono text-[10px] font-bold text-primary uppercase">
                                  {e.predicate.replace(/_/g, " ")}
                                </span>
                                <span className="text-zinc-400">→</span>
                                <span className="font-medium text-zinc-200">
                                  {nodeLabel(e.object_node_id, nodesById)}
                                </span>

                                {citation && (
                                  <button
                                    onClick={() =>
                                      setViewerDoc({
                                        documentId: citation.document_id,
                                        page: citation.page || 1,
                                      })
                                    }
                                    className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-evidence/40 px-2.5 py-1 font-mono text-[10px] text-zinc-400 hover:text-evidence transition-colors cursor-pointer"
                                  >
                                    <FileText className="h-3 w-3 text-evidence" />
                                    <span>{citation.document_id}</span>
                                    {citation.page ? <span>p.{citation.page}</span> : null}
                                  </button>
                                )}
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
          )}
        </div>
      </div>
    </div>
  );
}
