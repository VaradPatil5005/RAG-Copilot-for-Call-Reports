"use client";

import { useEffect, useState } from "react";
import {
  Activity, ShieldCheck, DollarSign, ClipboardCheck, Loader2, AlertTriangle,
  Database, GitBranch,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { getAdminOverview, getAuditLog, getLatestEvaluation, type AdminOverview, type AuditLogEntry, type EvaluationReport } from "@/lib/api";

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-text-faint" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-faint">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [evalReport, setEvalReport] = useState<EvaluationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [ov, al, ev] = await Promise.all([getAdminOverview(), getAuditLog({ limit: 20 }), getLatestEvaluation()]);
        if (cancelled) return;
        setOverview(ov);
        setAudit(al);
        setEvalReport(ev);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load admin data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center py-24 text-text-faint" role="status" aria-live="polite">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Loading operational data…
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="mx-8 mt-8 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-400" role="alert">
        {error}
      </div>
    );
  }

  if (!overview) return null;

  const totalCost = Object.values(overview.cost_usage.by_model).reduce(
    (sum, m) => (m.estimated_cost_usd === null ? sum : sum + m.estimated_cost_usd),
    0
  );
  const anyUnknownCost = Object.values(overview.cost_usage.by_model).some((m) => m.estimated_cost_usd === null);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Admin"
        title="Admin"
        description="System health, security posture, cost, and evaluation — every number here traces to a real persisted record or a live measurement."
      />

      <div className="mx-8">
        <Section title="System health" icon={Activity}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              label="API status"
              value={overview.health.status === "ok" ? "Healthy" : "Degraded"}
              icon={Activity}
              accent={overview.health.status === "ok" ? "primary" : "neutral"}
            />
            <MetricCard
              label="Generation provider"
              value={overview.health.services.generation_service?.includes("fallback") ? "Fallback" : "Live LLM"}
              delta={overview.health.services.generation_service}
              icon={Database}
              accent="neutral"
            />
            <MetricCard
              label="Embedding mode"
              value={overview.health.services.embedding_provider?.includes("fallback") ? "Fallback" : "Real"}
              delta={overview.health.services.embedding_provider}
              icon={Database}
              accent="neutral"
            />
            <MetricCard
              label="Ingestion queue depth"
              value={String(overview.ingestion_queue_depth_live ?? overview.ingestion_queue_depth_persisted)}
              delta={`${overview.ingestion_queue_depth_persisted} persisted in-progress`}
              icon={Activity}
              accent="neutral"
            />
          </div>
          <div className="mt-3 rounded-lg border border-border-subtle bg-elevated/40 px-4 py-3 text-[12px]">
            <div className="mb-1.5 flex items-center gap-2 font-medium text-text">
              <GitBranch className="h-3.5 w-3.5" /> Index versions (blue/green)
            </div>
            <div className="space-y-1">
              {overview.index_versions.map((v) => (
                <div key={v.name} className="flex items-center gap-2 text-text-muted">
                  <span className={v.is_active ? "text-primary font-medium" : ""}>{v.name}</span>
                  {v.is_active && <span className="rounded bg-primary-dim/20 px-1.5 py-0.5 text-[10px] text-primary">ACTIVE</span>}
                  <span className="text-text-faint">{v.vector_count ?? "?"} vectors</span>
                </div>
              ))}
              {overview.index_versions.length === 0 && <span className="text-text-faint">No index built yet.</span>}
            </div>
          </div>
        </Section>

        <Section title="Security" icon={ShieldCheck}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label="Zero-evidence responses (24h)"
              value={String(overview.security.zero_evidence_responses_last_24h)}
              icon={AlertTriangle}
              accent="neutral"
            />
            <MetricCard label="Tenants active (7d)" value={String(overview.security.tenant_access_summary_7d.length)} icon={ShieldCheck} accent="neutral" />
            <MetricCard
              label="Documents by classification"
              value={String(overview.security.document_access_summary.reduce((s, d) => s + d.n_documents, 0))}
              icon={Database}
              accent="neutral"
            />
          </div>
          <p className="mt-2 text-[11px] text-text-faint">{overview.security.zero_evidence_responses_caveat}</p>

          <div className="mt-4 overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full text-[12px]">
              <thead className="bg-elevated/60 text-text-faint">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Endpoint</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Identity</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Tenant</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Evidence count</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {audit.map((entry) => (
                  <tr key={entry.id} className={entry.evidence_count === 0 ? "bg-red-500/5" : ""}>
                    <td className="px-3 py-1.5 font-mono text-text-muted">{entry.endpoint}</td>
                    <td className="px-3 py-1.5 text-text-muted">{entry.identity_sub ?? "—"}</td>
                    <td className="px-3 py-1.5 text-text-muted">{entry.tenant_id}</td>
                    <td className="px-3 py-1.5 text-text-muted">
                      {entry.evidence_count}
                      {entry.evidence_count === 0 && (
                        <span className="ml-1.5 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">no evidence</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-text-faint">{new Date(entry.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-text-faint">
                      No audit entries yet — make a /search, /chat, or /graph/query request.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Cost / usage" icon={DollarSign}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard label="Queries (30d)" value={String(overview.cost_usage.n_queries_total)} icon={Activity} accent="neutral" />
            <MetricCard
              label="Estimated cost (30d)"
              value={anyUnknownCost ? `$${totalCost.toFixed(4)}+` : `$${totalCost.toFixed(4)}`}
              delta={anyUnknownCost ? "some models have unknown pricing" : undefined}
              icon={DollarSign}
              accent="neutral"
            />
            <MetricCard
              label="Models used"
              value={String(Object.keys(overview.cost_usage.by_model).length)}
              icon={Database}
              accent="neutral"
            />
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full text-[12px]">
              <thead className="bg-elevated/60 text-text-faint">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Model</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Calls</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Total tokens</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Est. cost</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Basis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {Object.entries(overview.cost_usage.by_model).map(([model, m]) => (
                  <tr key={model}>
                    <td className="px-3 py-1.5 font-mono text-text-muted">{model}</td>
                    <td className="px-3 py-1.5 text-text-muted">{m.n_calls}</td>
                    <td className="px-3 py-1.5 text-text-muted">{m.total_tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-text-muted">{m.estimated_cost_usd === null ? "unknown" : `$${m.estimated_cost_usd.toFixed(4)}`}</td>
                    <td className="px-3 py-1.5 text-text-faint">{m.cost_basis}</td>
                  </tr>
                ))}
                {Object.keys(overview.cost_usage.by_model).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-text-faint">
                      No /chat calls recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Evaluation" icon={ClipboardCheck}>
          {evalReport?.available ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard label="Hit rate" value={`${((evalReport.overall?.hit_rate ?? 0) * 100).toFixed(1)}%`} icon={ClipboardCheck} accent="primary" />
                <MetricCard label="MRR" value={(evalReport.overall?.mrr ?? 0).toFixed(3)} icon={ClipboardCheck} accent="neutral" />
                <MetricCard label="Faithfulness" value={(evalReport.overall?.mean_faithfulness ?? 0).toFixed(3)} icon={ClipboardCheck} accent="neutral" />
                <MetricCard label="Failure cases" value={String(evalReport.n_failure_cases ?? 0)} icon={AlertTriangle} accent="neutral" />
              </div>
              <p className="text-[11px] text-text-faint">
                Run {evalReport.run_id} · {evalReport.n_queries} queries · {evalReport.created_at && new Date(evalReport.created_at).toLocaleString()} ·
                95% CI on hit rate: [{evalReport.overall?.hit_rate_95ci?.[0]}, {evalReport.overall?.hit_rate_95ci?.[1]}]
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-border-subtle bg-elevated/40 px-4 py-6 text-center text-[13px] text-text-muted">
              {evalReport?.message ?? "No evaluation run recorded yet — POST /evaluation/run-full to populate this."}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
