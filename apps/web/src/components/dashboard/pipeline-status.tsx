"use client";

import { useEffect, useState } from "react";
import { FileStack, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { listDocuments, type DocumentSummary } from "@/lib/api";

const PIPELINE_STAGES = [
  { key: "queued", label: "Uploaded" },
  { key: "validating", label: "Validated" },
  { key: "extracting", label: "Layout extracted" },
  { key: "multimodal_extraction", label: "Multimodal routed" },
  { key: "normalizing", label: "Normalized" },
  { key: "chunking", label: "Chunked" },
  { key: "embedding", label: "Embedded" },
  { key: "indexing", label: "Vector indexed" },
  { key: "graph_extraction", label: "Graph extracted" },
  { key: "completed", label: "Ready for search" },
] as const;

const FUTURE_STAGES = ["Copilot answer"];

export function PipelineStatusPanel() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((d) => {
        if (!cancelled) {
          setDocuments(d);
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const countAtOrPast = (stageIndex: number) =>
    documents.filter((d) => {
      const status = d.latest?.status;
      if (!status) return false;
      const idx = PIPELINE_STAGES.findIndex((s) => s.key === status);
      // completed/duplicate count as having passed every stage
      if (status === "completed" || status === "duplicate") return true;
      if (status === "failed" || status === "dead_lettered" || status === "quarantined") {
        return idx >= 0 && idx <= stageIndex;
      }
      return idx >= stageIndex;
    }).length;

  const failedCount = documents.filter(
    (d) => d.latest && ["failed", "dead_lettered", "quarantined"].includes(d.latest.status)
  ).length;

  return (
    <div className="lg:col-span-2 rounded-xl border border-border-subtle bg-surface/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-text-faint">
            Ingestion pipeline
          </p>
          <p className="mt-1 font-display text-sm font-medium text-text">Document processing status</p>
        </div>
        {documents.length > 0 && (
          <span className="text-[11px] text-text-faint">{documents.length} documents</span>
        )}
      </div>

      <div className="mt-6 flex items-center gap-1 overflow-x-auto pb-2">
        {PIPELINE_STAGES.map((stage, i) => {
          const count = countAtOrPast(i);
          const active = count > 0;
          return (
            <div key={stage.key} className="flex items-center shrink-0">
              <div className="flex flex-col items-center gap-2 min-w-[92px]">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-mono",
                    active
                      ? "border-evidence-dim/60 bg-evidence-dim/20 text-evidence"
                      : "border-border-subtle bg-elevated text-text-faint"
                  )}
                >
                  {active ? count : i + 1}
                </div>
                <span
                  className={cn(
                    "text-[10px] text-center leading-tight",
                    active ? "text-text-muted" : "text-text-faint"
                  )}
                >
                  {stage.label}
                </span>
              </div>
              <div className="h-px w-6 bg-border-subtle shrink-0 mb-5" />
            </div>
          );
        })}
        {FUTURE_STAGES.map((label) => (
          <div key={label} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-2 min-w-[92px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border-subtle text-text-faint">
                <span className="text-[9px]">P3</span>
              </div>
              <span className="text-[10px] text-center leading-tight text-text-faint/70">{label}</span>
            </div>
          </div>
        ))}
      </div>

      {loaded && documents.length === 0 && (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle py-10 text-center">
          <FileStack className="h-6 w-6 text-text-faint" strokeWidth={1.5} />
          <p className="text-[13px] text-text-muted">No documents ingested yet</p>
          <p className="text-[12px] text-text-faint max-w-xs">
            Upload a call report in Documents to see it move through validation, extraction,
            chunking, embedding, and indexing in real time.
          </p>
        </div>
      )}

      {failedCount > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {failedCount} document{failedCount > 1 ? "s" : ""} need attention (failed, quarantined, or
          dead-lettered) — see Documents.
        </div>
      )}
    </div>
  );
}
