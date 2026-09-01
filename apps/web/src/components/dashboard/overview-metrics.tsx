"use client";

import { useEffect, useState } from "react";
import { FileStack, MessagesSquare, Clock, ShieldCheck } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { getDocumentStats, type DocumentStats } from "@/lib/api";

export function OverviewMetrics() {
  const [stats, setStats] = useState<DocumentStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDocumentStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const documentsProcessed = stats ? stats.completed : "0";

  return (
    <div className="grid grid-cols-1 gap-4 px-8 lg:grid-cols-4">
      <MetricCard
        label="Documents processed"
        value={String(documentsProcessed)}
        icon={FileStack}
        accent="neutral"
      />
      <MetricCard label="AI queries" value="0" icon={MessagesSquare} accent="primary" />
      <MetricCard label="Avg response time" value="—" icon={Clock} accent="neutral" />
      <MetricCard label="Citation accuracy" value="—" icon={ShieldCheck} accent="evidence" />
    </div>
  );
}
