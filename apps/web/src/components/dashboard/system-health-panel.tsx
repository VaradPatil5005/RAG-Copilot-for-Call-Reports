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
    <div className="rounded-xl border border-border-subtle bg-surface/60 p-5">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-evidence" strokeWidth={1.75} />
        <p className="font-display text-sm font-medium text-text">System health</p>
      </div>
      <div className="mt-4 space-y-3">
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
    <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-elevated/40 px-3 py-2.5">
      <span className="text-[12px] text-text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        {up ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : bad ? (
          <XCircle className="h-3.5 w-3.5 text-error" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-text-faint" />
        )}
        <span className="text-[11px] text-text-faint capitalize">{status}</span>
      </div>
    </div>
  );
}
