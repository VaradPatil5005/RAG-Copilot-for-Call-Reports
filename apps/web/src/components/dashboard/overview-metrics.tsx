"use client";

import { useEffect, useState } from "react";
import { FileStack, MessagesSquare, Clock, ShieldCheck } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import {
  getDocumentStats,
  getSystemMetrics,
  type DocumentStats,
  type SystemMetrics,
} from "@/lib/api";

export function OverviewMetrics() {
  const [docStats, setDocStats] = useState<DocumentStats | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;

    function fetchAll() {
      getDocumentStats()
        .then((s) => !cancelled && setDocStats(s))
        .catch(() => {});
      getSystemMetrics()
        .then((m) => !cancelled && setMetrics(m))
        .catch(() => {});
    }

    fetchAll();
    // Auto-refresh every 6 seconds so the dashboard updates live as queries are executed
    const interval = setInterval(fetchAll, 6000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const documentsProcessed = docStats ? docStats.completed : "0";
  const aiQueries = metrics?.n_traces ?? 0;

  // Format response time (p50 median)
  const p50 = metrics?.latency_ms?.p50;
  const avgResponseTime =
    p50 != null
      ? p50 < 1000
        ? `${Math.round(p50)}ms`
        : `${(p50 / 1000).toFixed(1)}s`
      : "—";

  // Format citation accuracy
  const passRate = metrics?.citation_validation_pass_rate;
  const citationAccuracy =
    passRate != null ? `${(passRate * 100).toFixed(1)}%` : "—";

  return (
    <div className="grid grid-cols-1 gap-4 px-8 lg:grid-cols-4">
      <MetricCard
        label="Documents processed"
        value={String(documentsProcessed)}
        icon={FileStack}
        accent="neutral"
        delta={docStats?.total ? `${docStats.total} total` : undefined}
      />
      <MetricCard
        label="AI queries"
        value={String(aiQueries)}
        icon={MessagesSquare}
        accent="primary"
        delta={aiQueries > 0 ? "Live traces" : undefined}
        deltaTone={aiQueries > 0 ? "positive" : "neutral"}
      />
      <MetricCard
        label="Avg response time"
        value={avgResponseTime}
        icon={Clock}
        accent="neutral"
        delta={p50 != null ? "p50 median" : undefined}
      />
      <MetricCard
        label="Citation accuracy"
        value={citationAccuracy}
        icon={ShieldCheck}
        accent="evidence"
        delta={passRate != null ? "Grounded" : undefined}
        deltaTone={passRate != null ? "positive" : "neutral"}
      />
    </div>
  );
}
