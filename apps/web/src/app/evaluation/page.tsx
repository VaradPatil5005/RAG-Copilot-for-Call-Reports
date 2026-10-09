"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ClipboardCheck,
  Loader2,
  PlayCircle,
  Zap,
  AlertTriangle,
  RefreshCw,
  Clock,
  ShieldCheck,
  Target,
  Sparkles,
  Layers,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import {
  getLatestEvaluation,
  runRetrievalEval,
  runFullEvaluation,
  type EvaluationReport,
  type RetrievalEvalReport,
} from "@/lib/api";
import { cn } from "@/lib/utils";

function pct(n: number | undefined): string {
  return n === undefined || n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

export default function EvaluationPage() {
  const [latest, setLatest] = useState<EvaluationReport | null>(null);
  const [quick, setQuick] = useState<RetrievalEvalReport | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningQuick, setRunningQuick] = useState(false);
  const [runningFull, setRunningFull] = useState(false);
  const [useV2GoldSet, setUseV2GoldSet] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const loadLatest = useCallback(async () => {
    try {
      const report = await getLatestEvaluation();
      setLatest(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the latest evaluation run");
    } finally {
      setLoadingLatest(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  // Elapsed timer while full run is active
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (runningFull) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [runningFull]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    await loadLatest();
  };

  const handleQuickRun = useCallback(async () => {
    setRunningQuick(true);
    setError(null);
    try {
      const report = await runRetrievalEval({ use_v2_gold_set: useV2GoldSet });
      setQuick(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retrieval-only eval failed");
    } finally {
      setRunningQuick(false);
    }
  }, [useV2GoldSet]);

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
    <div className="pb-16 min-h-screen">
      <PageHeader
        eyebrow="Decision Quality Intelligence"
        title="Evaluation Benchmark"
        description="Retrieval accuracy and generation quality measured against verified gold benchmarks — real evaluations behind every number, never a mock."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing || runningFull || runningQuick}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-3 py-2 text-xs font-medium text-zinc-300 transition-colors disabled:opacity-50 cursor-pointer"
              title="Reload latest recorded benchmark"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 text-zinc-400", refreshing && "animate-spin")} />
              <span>Refresh</span>
            </button>

            <button
              onClick={handleQuickRun}
              disabled={runningQuick || runningFull}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-3.5 py-2 text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {runningQuick ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <Zap className="h-3.5 w-3.5 text-amber-400" />}
              <span>Quick Retrieval Check</span>
            </button>

            <button
              onClick={handleFullRun}
              disabled={runningFull || runningQuick}
              className="flex items-center gap-2 rounded-xl bg-brand-fill hover:bg-brand-press px-4 py-2 text-xs font-bold text-paper transition-all shadow-md disabled:opacity-50 cursor-pointer"
            >
              {runningFull ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              <span>{runningFull ? `Running (${elapsedSeconds}s)…` : "Run Full Benchmark"}</span>
            </button>
          </div>
        }
      />

      <div className="mx-4 lg:mx-8 space-y-6">
        {/* Mode & Configuration Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#141312]/85 backdrop-blur-xl p-4 shadow-xl">
          <div className="flex items-center gap-3">
            <input
              id="v2-gold-set"
              type="checkbox"
              checked={useV2GoldSet}
              onChange={(e) => setUseV2GoldSet(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/[0.05] text-primary focus:ring-0 cursor-pointer"
            />
            <label htmlFor="v2-gold-set" className="text-xs text-zinc-300 cursor-pointer select-none">
              <span className="font-semibold text-white">Full 300+ Stratified Gold Benchmark</span>
              <span className="text-zinc-400 block text-[11px] mt-0.5">
                {useV2GoldSet
                  ? "Evaluating 317 stratified gold queries across all 7 intent categories (single-doc, multi-doc, temporal, table, cross-customer, negative, abstention)"
                  : "Unchecked: Evaluating 10 canonical gold queries tailored to ingested Contoso & Globex call reports"}
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-300 bg-white/[0.05] border border-white/[0.1] rounded-xl px-3 py-1.5 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Mode: {useV2GoldSet ? "317 Stratified Gold Queries" : "10 Canonical Queries"}</span>
          </div>
        </div>

        {/* Live Running Status Banner */}
        {runningFull && (
          <div className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-xs text-white shadow-xl animate-pulse">
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
            <div>
              <p className="font-semibold text-primary">Executing Full Quality Benchmark ({elapsedSeconds}s elapsed)</p>
              <p className="text-zinc-400 text-[11px] mt-0.5">
                Evaluating hybrid retrieval, structured answer generation, citation claim validation, and faithfulness checks...
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 shadow-md">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Quick Retrieval Run Card */}
        {quick && (
          <div className="rounded-2xl border border-white/10 bg-[#141312]/85 backdrop-blur-xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
                <Zap className="h-4 w-4 text-amber-400" />
                <span>Quick Retrieval-Only Verification (Run Result)</span>
              </div>
              <span className="text-[11px] font-mono text-zinc-500">{quick.n_queries} queries</span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Hit Rate@k" value={pct(quick.hit_rate_at_k)} icon={Target} accent="primary" />
              <MetricCard label="MRR@k" value={pct(quick.mrr_at_k)} icon={ClipboardCheck} accent="primary" />
              <MetricCard label="Queries Tested" value={String(quick.n_queries)} icon={Layers} />
              <MetricCard
                label="Providers"
                value={quick.embedding_provider_is_fallback || quick.reranker_provider_is_fallback ? "Fallback active" : "Live Models"}
                icon={ShieldCheck}
                accent={quick.embedding_provider_is_fallback || quick.reranker_provider_is_fallback ? "neutral" : "primary"}
              />
            </div>
            <p className="text-[11px] font-mono text-zinc-500 leading-relaxed">{quick.caveat}</p>
          </div>
        )}

        {/* Main Latest Full Benchmark Section */}
        {loadingLatest ? (
          <div className="rounded-2xl border border-white/10 bg-[#141312]/60 p-12 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Loading latest evaluation benchmark…</span>
          </div>
        ) : !latest?.available ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-12 text-center space-y-3">
            <ClipboardCheck className="mx-auto h-8 w-8 text-zinc-500" strokeWidth={1.5} />
            <h3 className="font-display text-sm font-medium text-white">No benchmark recorded yet</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              {latest?.message ?? "Click 'Run Full Benchmark' above to evaluate retrieval hit rate, MRR, answer faithfulness, and citation precision."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Run Overview Metrics */}
            <div className="rounded-2xl border border-white/10 bg-[#141312]/85 backdrop-blur-xl p-5 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="font-mono text-xs font-bold text-white uppercase tracking-wider">
                    Benchmark Run: {latest.run_id}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
                  <span>{latest.n_queries} queries evaluated</span>
                  <span className="text-zinc-600">|</span>
                  <span>{new Date(latest.created_at || "").toLocaleString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  label="Retrieval Hit Rate"
                  value={pct(latest.overall?.hit_rate)}
                  icon={Target}
                  accent="primary"
                />
                <MetricCard
                  label="Mean Reciprocal Rank (MRR)"
                  value={pct(latest.overall?.mrr)}
                  icon={ClipboardCheck}
                  accent="primary"
                />
                <MetricCard
                  label="Abstention Accuracy"
                  value={pct(latest.overall?.abstention_accuracy)}
                  icon={ShieldCheck}
                />
                <MetricCard
                  label="Claim Faithfulness"
                  value={pct(latest.overall?.mean_faithfulness)}
                  icon={Sparkles}
                  accent="primary"
                />
              </div>

              {latest.overall?.latency_ms && (
                <div className="pt-2 flex flex-wrap items-center gap-4 text-xs font-mono text-zinc-400 border-t border-white/[0.06]">
                  <span className="text-zinc-500">Latency:</span>
                  <span>p50: <strong className="text-white">{latest.overall.latency_ms.p50 ?? "—"}ms</strong></span>
                  <span>p95: <strong className="text-white">{latest.overall.latency_ms.p95 ?? "—"}ms</strong></span>
                  <span>p99: <strong className="text-white">{latest.overall.latency_ms.p99 ?? "—"}ms</strong></span>
                </div>
              )}
            </div>

            {/* By-Category Breakdown */}
            {latest.by_category && Object.keys(latest.by_category).length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#141312]/85 backdrop-blur-xl overflow-hidden shadow-xl">
                <div className="border-b border-white/10 bg-white/[0.03] px-5 py-3 text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span>Stratified Intent Breakdown</span>
                  </div>
                  <span className="text-[11px] text-zinc-500 font-mono">
                    {Object.keys(latest.by_category).length} categories
                  </span>
                </div>

                <div className="divide-y divide-white/[0.06]">
                  {Object.entries(latest.by_category).map(([category, stats]) => (
                    <div
                      key={category}
                      className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="rounded-md bg-primary/10 border border-primary/25 px-2 py-0.5 font-mono text-[10px] uppercase text-primary font-bold">
                          {category.replace(/_/g, " ")}
                        </span>
                        <span className="font-mono text-xs text-zinc-400">n = {stats.n}</span>
                      </div>

                      <div className="flex items-center gap-5 text-xs font-mono">
                        <span className="text-zinc-300">
                          Hit Rate: <strong className="text-white">{pct(stats.hit_rate)}</strong>
                        </span>
                        <span className="text-zinc-300">
                          MRR: <strong className="text-white">{pct(stats.mrr)}</strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failure Cases Breakdown */}
            {typeof latest.n_failure_cases === "number" && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-xs text-zinc-400 flex items-center justify-between">
                <span>
                  {latest.n_failure_cases === 0
                    ? "Zero failure cases recorded in this evaluation run — 100% compliance across all tested benchmarks."
                    : `${latest.n_failure_cases} failure case${latest.n_failure_cases === 1 ? "" : "s"} logged in audit store for targeted model fine-tuning.`}
                </span>
                <span className="text-[11px] font-mono text-zinc-500">Run ID: {latest.run_id}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
