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
    <div className="lg:col-span-2 rounded-2xl border border-white/8 bg-surface/70 backdrop-blur-xl p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] hover:border-white/14 transition-all">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_6px_rgba(79,209,197,0.8)]" />
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-faint">
              SYS.PIPELINE // INGESTION MESH
            </p>
          </div>
          <p className="mt-1 font-display text-base font-bold text-text">
            Quantum Document Processing Pipeline
          </p>
        </div>
        {documents.length > 0 && (
          <span className="font-mono text-[11px] rounded-full border border-evidence/25 bg-evidence/10 px-3 py-1 text-evidence font-medium shadow-[0_0_10px_rgba(79,209,197,0.15)]">
            {documents.length} ingested
          </span>
        )}
      </div>

      <div className="mt-6 flex items-center gap-1 overflow-x-auto pb-3">
        {PIPELINE_STAGES.map((stage, i) => {
          const count = countAtOrPast(i);
          const active = count > 0;
          return (
            <div key={stage.key} className="flex items-center shrink-0">
              <div className="flex flex-col items-center gap-2 min-w-[96px]">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl border text-[11px] font-mono font-bold transition-all duration-300",
                    active
                      ? "border-evidence/50 bg-evidence/15 text-evidence shadow-[0_0_15px_rgba(79,209,197,0.3)]"
                      : "border-white/8 bg-elevated-2/60 text-text-faint"
                  )}
                >
                  {active ? count : i + 1}
                </div>
                <span
                  className={cn(
                    "text-[10px] text-center leading-tight font-medium max-w-[85px]",
                    active ? "text-text" : "text-text-faint"
                  )}
                >
                  {stage.label}
                </span>
              </div>
              <div
                className={cn(
                  "h-0.5 w-5 shrink-0 mb-5 transition-colors",
                  active ? "bg-evidence/40" : "bg-white/5"
                )}
              />
            </div>
          );
        })}
        {FUTURE_STAGES.map((label) => (
          <div key={label} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-2 min-w-[96px]">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-dashed border-white/10 text-text-faint/70 bg-elevated/30">
                <span className="text-[10px] font-mono font-bold">P3</span>
              </div>
              <span className="text-[10px] text-center leading-tight text-text-faint/60 max-w-[85px]">{label}</span>
            </div>
          </div>
        ))}
      </div>

      {loaded && documents.length === 0 && (
        <div className="mt-6 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-elevated/20 py-10 text-center">
          <div className="h-10 w-10 rounded-xl bg-elevated-2/80 flex items-center justify-center text-text-faint border border-white/5">
            <FileStack className="h-5 w-5 text-evidence/70" strokeWidth={1.5} />
          </div>
          <p className="text-[13px] font-medium text-text-muted">No documents ingested in this tenant</p>
          <p className="text-[12px] text-text-faint max-w-sm leading-relaxed">
            Upload a call report in Documents to activate the real-time extraction, layout normalization, and indexing pipeline.
          </p>
        </div>
      )}

      {failedCount > 0 && (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-[12px] text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {failedCount} document{failedCount > 1 ? "s" : ""} flagged for inspection (quarantined or retry queue).
          </span>
        </div>
      )}
    </div>
  );
}
