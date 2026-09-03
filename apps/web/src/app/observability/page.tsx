"use client";

/**
 * feature/decision-intelligence-layer, Phase C (net-new page, not editing
 * the existing /admin page).
 *
 * The stage-latency breakdown, per-query cost table, and failure log
 * below are genuinely new (see app/observability/dashboard.py). The
 * "Live chat metrics" section is the existing `/system/metrics` payload,
 * only displayed here for convenience -- not recomputed, not duplicated.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertOctagon, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { getObservabilityDashboard, type ObservabilityDashboard } from "@/lib/api";

function fmtMs(n: number | undefined): string {
  return n === undefined ? "—" : `${Math.round(n)}ms`;
}

export default function ObservabilityPage() {
  const [data, setData] = useState<ObservabilityDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getObservabilityDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the observability dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chatMetrics = data?.chat_metrics as
    | { fallback_provider_rate?: number; json_retry_rate?: number; abstention_rate?: number; citation_validation_pass_rate?: number; latency_ms?: { p50?: number; p95?: number; p99?: number } }
    | undefined;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Observability"
        title="Observability"
        description="Retrieval-stage latency, per-query cost, and a failure log — layered on top of the existing live chat metrics (fallback-provider rate, JSON-retry rate, abstention rate, citation-validation pass rate)."
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3.5 py-2 text-[12px] font-medium text-text-muted transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        }
      />

      {error && (
        <div className="mx-8 mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400" role="alert">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="mx-8 flex items-center gap-2 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : data ? (
        <div className="mx-8 space-y-8">
          <div>
            <p className="mb-3 text-[12px] font-medium text-text-faint">Live chat metrics (existing, from /system/metrics)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Fallback-provider rate" value={chatMetrics?.fallback_provider_rate !== undefined ? `${(chatMetrics.fallback_provider_rate * 100).toFixed(1)}%` : "—"} icon={Activity} />
              <MetricCard label="JSON-retry rate" value={chatMetrics?.json_retry_rate !== undefined ? `${(chatMetrics.json_retry_rate * 100).toFixed(1)}%` : "—"} icon={Activity} />
              <MetricCard label="Abstention rate" value={chatMetrics?.abstention_rate !== undefined ? `${(chatMetrics.abstention_rate * 100).toFixed(1)}%` : "—"} icon={Activity} />
              <MetricCard label="Citation pass rate" value={chatMetrics?.citation_validation_pass_rate !== undefined ? `${(chatMetrics.citation_validation_pass_rate * 100).toFixed(1)}%` : "—"} icon={Activity} />
            </div>
          </div>

          <div>
            <p className="mb-3 text-[12px] font-medium text-text-faint">Retrieval-stage latency breakdown (new)</p>
            {data.stage_latency.n_rows === 0 ? (
              <p className="text-[13px] text-text-muted">{data.stage_latency.message ?? "No stage timings recorded yet — run a /chat query first."}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border-subtle">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-surface/60 text-text-faint">
                    <tr>
                      <th className="px-3 py-2 font-medium">Stage</th>
                      <th className="px-3 py-2 font-medium">Calls</th>
                      <th className="px-3 py-2 font-medium">p50</th>
                      <th className="px-3 py-2 font-medium">p95</th>
                      <th className="px-3 py-2 font-medium">p99</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.stage_latency.by_stage).map(([stage, s]) => (
                      <tr key={stage} className="border-t border-border-subtle/60">
                        <td className="px-3 py-2 text-text">{stage}</td>
                        <td className="px-3 py-2 text-text-muted">{s.n}</td>
                        <td className="px-3 py-2 text-text-muted">{fmtMs(s.p50)}</td>
                        <td className="px-3 py-2 text-text-muted">{fmtMs(s.p95)}</td>
                        <td className="px-3 py-2 text-text-muted">{fmtMs(s.p99)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <p className="mb-3 text-[12px] font-medium text-text-faint">Cost per query, most recent (new)</p>
            {data.cost_per_query.n_queries === 0 ? (
              <p className="text-[13px] text-text-muted">No chat traces yet.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border-subtle">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-surface/60 text-text-faint">
                    <tr>
                      <th className="px-3 py-2 font-medium">Query</th>
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium">Tokens</th>
                      <th className="px-3 py-2 font-medium">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cost_per_query.queries.slice(0, 15).map((q) => (
                      <tr key={q.trace_id} className="border-t border-border-subtle/60">
                        <td className="max-w-[280px] truncate px-3 py-2 text-text" title={q.query_preview}>{q.query_preview}</td>
                        <td className="px-3 py-2 text-text-muted">{q.model_name}</td>
                        <td className="px-3 py-2 text-text-muted">{q.total_tokens}</td>
                        <td className="px-3 py-2 text-text-muted">
                          {q.estimated_cost_usd === null ? "unknown" : `$${q.estimated_cost_usd.toFixed(5)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <p className="mb-3 text-[12px] font-medium text-text-faint">Failure / error log (new)</p>
            {data.failures.n_failures === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border-subtle px-3 py-3 text-[13px] text-text-muted">
                <AlertOctagon className="h-4 w-4 text-text-faint" /> No failures recorded.
              </div>
            ) : (
              <ul className="space-y-2">
                {data.failures.failures.slice(0, 15).map((f) => (
                  <li key={f.id} className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px]">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-medium">{f.stage}</span>
                      <span className="text-text-faint">· {f.created_at}</span>
                    </div>
                    <p className="mt-1 text-text-muted">{f.error_message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
