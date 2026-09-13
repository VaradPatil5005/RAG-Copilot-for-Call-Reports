"use client";

import { useEffect, useState } from "react";
import { Gauge, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { getSystemHealth, type SystemHealth } from "@/lib/api";

const LABELS: Record<string, string> = {
  api: "Local dev API",
  ingestion_pipeline: "Document processing worker",
  metadata_store: "Metadata store",
  search_index: "Retrieval index",
  generation_service: "Copilot generation service",
};

const ORDER = ["api", "ingestion_pipeline", "metadata_store", "search_index", "generation_service"];

export function SystemHealthPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSystemHealth()
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setUnreachable(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = health
    ? ORDER.filter((k) => k in health.services).map((k) => ({
        label: LABELS[k] || k,
        status: health.services[k],
      }))
    : [
        { label: "Local dev API", status: unreachable ? "Unreachable" : "Checking…" },
        { label: "Document processing worker", status: unreachable ? "Unreachable" : "Checking…" },
        { label: "Retrieval index", status: "Not provisioned" },
        { label: "Copilot generation service", status: "Not provisioned" },
      ];

  return (
    <div className="rounded-2xl border border-white/8 bg-surface/70 backdrop-blur-xl p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] hover:border-white/14 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_6px_rgba(79,209,197,0.8)]" />
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-faint">
              SYS.TELEMETRY // CLUSTER
            </p>
          </div>
          <p className="mt-1 font-display text-base font-bold text-text">Infrastructure Health</p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-evidence/10 border border-evidence/25 text-evidence shadow-[0_0_12px_rgba(79,209,197,0.2)]">
          <Gauge className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <HealthRow key={r.label} label={r.label} status={r.status} />
        ))}
      </div>
    </div>
  );
}

function HealthRow({ label, status }: { label: string; status: string }) {
  const up = status.toLowerCase().startsWith("up");
  const bad = status.toLowerCase() === "unreachable";
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/6 bg-elevated/40 px-3.5 py-2.5 hover:border-white/12 transition-all">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <div className="flex items-center gap-2">
        {up ? (
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-success">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            <span className="rounded-full bg-success/15 px-2 py-0.5 border border-success/25">
              ONLINE
            </span>
          </span>
        ) : bad ? (
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-error">
            <XCircle className="h-3.5 w-3.5 text-error" />
            <span className="rounded-full bg-error/15 px-2 py-0.5 border border-error/25">
              OFFLINE
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-faint">
            <AlertTriangle className="h-3.5 w-3.5 text-text-faint" />
            <span className="rounded-full bg-elevated px-2 py-0.5 border border-white/5 capitalize">
              {status}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
