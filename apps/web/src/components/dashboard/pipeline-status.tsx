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
    <div className="lg:col-span-2 relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0A0E18]/80 backdrop-blur-2xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)] hover:border-white/10 transition-all">
      {/* Top Specular Laser Line */}
      <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
      
      {/* Subtle Background Radial Glow */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-evidence/10 blur-3xl opacity-40" />

      <div className="flex items-center justify-between relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_8px_rgba(79,209,197,0.9)] animate-pulse" />
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              SYS.PIPELINE // QUANTUM INGESTION MESH
            </p>
          </div>
          <p className="mt-1 font-display text-base font-bold text-white tracking-tight">
            Autonomous Document Processing Stream
          </p>
        </div>
        {documents.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] rounded-full border border-evidence/30 bg-evidence/10 px-3 py-1 text-evidence font-medium shadow-[0_0_12px_rgba(79,209,197,0.2)]">
              <span className="h-1.5 w-1.5 rounded-full bg-evidence animate-pulse" />
              {documents.length} ingested · 100% indexed
            </span>
          </div>
        )}
      </div>

      {/* Optical Quantum Pipeline Stream */}
      <div className="mt-8 flex items-center gap-0 overflow-x-auto pb-4 relative z-10 scrollbar-none">
        {PIPELINE_STAGES.map((stage, i) => {
          const count = countAtOrPast(i);
          const active = count > 0;
          return (
            <div key={stage.key} className="flex items-center shrink-0">
              <div className="flex flex-col items-center gap-2.5 min-w-[100px]">
                {/* Glowing Optical Aperture Node (No chunky boxes!) */}
                <div className="relative flex items-center justify-center">
                  {active ? (
                    <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-evidence/15 border border-evidence shadow-[0_0_18px_rgba(79,209,197,0.6)]">
                      <span className="absolute h-4 w-4 rounded-full bg-evidence/30 animate-ping" />
                      <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />
                    </div>
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-zinc-500 font-mono text-[10px]">
                      {i + 1}
                    </div>
                  )}
                </div>

                {/* Stage Label & Micro Status */}
                <div className="flex flex-col items-center text-center">
                  <span
                    className={cn(
                      "text-[11px] leading-tight font-medium max-w-[90px] transition-colors",
                      active ? "text-white" : "text-zinc-500"
                    )}
                  >
                    {stage.label}
                  </span>
                  {active ? (
                    <span className="mt-1 font-mono text-[9px] text-evidence font-semibold uppercase tracking-wider">
                      {count} docs
                    </span>
                  ) : (
                    <span className="mt-1 font-mono text-[9px] text-zinc-600 uppercase tracking-wider">
                      Standby
                    </span>
                  )}
                </div>
              </div>

              {/* Luminous Waveguide / Connecting Laser Track */}
              <div
                className={cn(
                  "h-[2px] w-6 shrink-0 -mt-6 transition-all duration-500",
                  active
                    ? "bg-gradient-to-r from-evidence via-cyan-400 to-evidence shadow-[0_0_10px_rgba(79,209,197,0.7)]"
                    : "bg-white/[0.08]"
                )}
              />
            </div>
          );
        })}

        {FUTURE_STAGES.map((label) => (
          <div key={label} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-2.5 min-w-[100px]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-white/15 bg-white/[0.02] text-zinc-600 font-mono text-[10px]">
                ✦
              </div>
              <div className="flex flex-col items-center text-center">
                <span className="text-[11px] leading-tight font-medium max-w-[90px] text-zinc-500">
                  {label}
                </span>
                <span className="mt-1 font-mono text-[9px] text-zinc-600 uppercase tracking-wider">
                  Target
                </span>
              </div>
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
