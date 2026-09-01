"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2, PlayCircle, Zap, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import {
  getLatestEvaluation,
  runRetrievalEval,
  runFullEvaluation,
  type EvaluationReport,
  type RetrievalEvalReport,
} from "@/lib/api";

function pct(n: number | undefined): string {
  return n === undefined || n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

export default function EvaluationPage() {
  const [latest, setLatest] = useState<EvaluationReport | null>(null);
  const [quick, setQuick] = useState<RetrievalEvalReport | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [runningQuick, setRunningQuick] = useState(false);
  const [runningFull, setRunningFull] = useState(false);
  const [useV2GoldSet, setUseV2GoldSet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const report = await getLatestEvaluation();
      setLatest(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the latest evaluation run");
    } finally {
      setLoadingLatest(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const handleQuickRun = useCallback(async () => {
    setRunningQuick(true);
    setError(null);
    try {
      const report = await runRetrievalEval();
      setQuick(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retrieval-only eval failed");
    } finally {
      setRunningQuick(false);
    }
  }, []);

  const handleFullRun = useCallback(async () => {
    setRunningFull(true);
    setError(null);
    try {
      const report = await runFullEvaluation({ use_v2_gold_set: useV2GoldSet });
      setLatest(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Full benchmark run failed");
    } finally {
      setRunningFull(false);
    }
  }, [useV2GoldSet]);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Evaluation"
        title="Evaluation"
        description="Retrieval and generation quality measured against the gold benchmark — a real run behind every number, never a placeholder."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleQuickRun}
              disabled={runningQuick}
              className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-[12px] font-medium text-text-muted transition-colors hover:bg-elevated disabled:opacity-50"
            >
              {runningQuick ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Quick retrieval check
            </button>
            <button
              onClick={handleFullRun}
              disabled={runningFull}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-medium text-white transition-opacity disabled:opacity-50"
            >
              {runningFull ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Run full benchmark
            </button>
          </div>
        }
      />

      <div className="mx-8 mb-4 flex items-center gap-2 text-[12px] text-text-faint">
        <input
          id="v2-gold-set"
          type="checkbox"
          checked={useV2GoldSet}
          onChange={(e) => setUseV2GoldSet(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border-subtle"
        />
        <label htmlFor="v2-gold-set">
          Use the 300+ query stratified gold set (slower — one real generation call per query)
        </label>
      </div>

      {error && (
        <div className="mx-8 mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {quick && (
        <div className="mx-8 mb-6 rounded-xl border border-border-subtle bg-surface/60 p-4">
          <p className="mb-3 text-[12px] font-medium text-text-faint">Quick retrieval-only check (this run)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Hit Rate@k" value={pct(quick.hit_rate_at_k)} icon={ClipboardCheck} />
            <MetricCard label="MRR@k" value={pct(quick.mrr_at_k)} icon={ClipboardCheck} />
            <MetricCard label="Queries" value={String(quick.n_queries)} icon={ClipboardCheck} />
            <MetricCard
              label="Providers"
              value={quick.embedding_provider_is_fallback || quick.reranker_provider_is_fallback ? "Fallback active" : "Live"}
              icon={ClipboardCheck}
              accent={quick.embedding_provider_is_fallback || quick.reranker_provider_is_fallback ? "neutral" : "primary"}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-faint">{quick.caveat}</p>
        </div>
      )}

      {loadingLatest ? (
        <div className="mx-8 flex items-center gap-2 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading latest run…
        </div>
      ) : !latest?.available ? (
        <div className="mx-8 rounded-xl border border-dashed border-border-subtle bg-surface/40 p-8 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-6 w-6 text-text-faint" strokeWidth={1.5} />
          <p className="text-[13px] text-text-muted">
            {latest?.message ?? "No full benchmark has been run yet."}
          </p>
          <p className="mt-1 text-[12px] text-text-faint">
            Click &ldquo;Run full benchmark&rdquo; above — it runs retrieval, generation, and citation
            validation over the gold set and persists the report.
          </p>
        </div>
      ) : (
        <div className="mx-8 space-y-6">
          <div>
            <p className="mb-3 text-[12px] font-medium text-text-faint">
              Latest full run — {latest.run_id} · {latest.n_queries} queries · {latest.created_at}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Hit Rate" value={pct(latest.overall?.hit_rate)} icon={ClipboardCheck} accent="primary" />
              <MetricCard label="MRR" value={pct(latest.overall?.mrr)} icon={ClipboardCheck} accent="primary" />
              <MetricCard label="Abstention accuracy" value={pct(latest.overall?.abstention_accuracy)} icon={ClipboardCheck} />
              <MetricCard label="Faithfulness" value={pct(latest.overall?.mean_faithfulness)} icon={ClipboardCheck} />
            </div>
          </div>

          {latest.by_category && (
            <div className="rounded-xl border border-border-subtle bg-surface/60">
              <div className="border-b border-border-subtle px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                By category
              </div>
              <div className="divide-y divide-border-subtle">
                {Object.entries(latest.by_category).map(([category, stats]) => (
                  <div key={category} className="flex items-center justify-between px-4 py-2.5 text-[12px]">
                    <span className="text-text">{category}</span>
                    <span className="text-text-faint">
                      n={stats.n} · Hit Rate {pct(stats.hit_rate)} · MRR {pct(stats.mrr)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {typeof latest.n_failure_cases === "number" && (
            <p className="text-[12px] text-text-faint">
              {latest.n_failure_cases} failure case{latest.n_failure_cases === 1 ? "" : "s"} recorded in this run.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
