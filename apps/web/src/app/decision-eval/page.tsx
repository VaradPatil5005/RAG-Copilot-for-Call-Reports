"use client";

/**
 * feature/decision-intelligence-layer, Phase B (net-new page, not editing
 * the existing /evaluation page).
 *
 * Surfaces the one genuinely new metric this phase adds -- policy-block
 * accuracy, which no existing page shows -- alongside a read-only summary
 * of citation precision / faithfulness / abstention accuracy /
 * unsupported-claim rate, all of which are already computed by the
 * existing evaluation harness (see /evaluation and app/evaluation/
 * full_benchmark.py) and are only being *displayed* again here, not
 * recomputed.
 */

import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, PlayCircle, AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import {
  getDecisionEvalSummary,
  getLatestPolicyBlockEval,
  runPolicyBlockEval,
  type DecisionEvalSummary,
  type PolicyBlockReport,
} from "@/lib/api";

function pct(n: number | null | undefined): string {
  return n === undefined || n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

export default function DecisionEvalPage() {
  const [summary, setSummary] = useState<DecisionEvalSummary | null>(null);
  const [policy, setPolicy] = useState<PolicyBlockReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryReport, policyReport] = await Promise.all([
        getDecisionEvalSummary(),
        getLatestPolicyBlockEval(),
      ]);
      setSummary(summaryReport);
      setPolicy(policyReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the decision intelligence summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const report = await runPolicyBlockEval();
      setPolicy(report);
      const summaryReport = await getDecisionEvalSummary();
      setSummary(summaryReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Policy-block eval run failed");
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Decision Intelligence"
        title="Decision Intelligence"
        description="Policy-block accuracy — a new benchmark metric scoring whether ACL enforcement's actual outcome matches expectation — shown alongside the existing citation precision, faithfulness, and abstention accuracy numbers from the evaluation harness."
        actions={
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-medium text-white transition-opacity disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Run policy-block eval
          </button>
        }
      />

      {error && (
        <div className="mx-8 mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="mx-8 flex items-center gap-2 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="mx-8 space-y-8">
          <div>
            <p className="mb-3 text-[12px] font-medium text-text-faint">Policy-block accuracy (new)</p>
            {!policy || policy.available === false ? (
              <div className="rounded-xl border border-dashed border-border-subtle bg-surface/40 p-8 text-center">
                <Brain className="mx-auto mb-3 h-6 w-6 text-text-faint" strokeWidth={1.5} />
                <p className="text-[13px] text-text-muted">
                  {policy?.message ?? "No policy-block eval has been run yet."}
                </p>
                <p className="mt-1 text-[12px] text-text-faint">
                  Click &ldquo;Run policy-block eval&rdquo; above — it checks, for each gold case, whether the
                  ACL-enforced retrieval path actually blocks or allows evidence the way it should.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricCard
                    label="Policy-block accuracy"
                    value={pct(policy.policy_block_accuracy)}
                    icon={ShieldCheck}
                    accent={policy.false_allow_count > 0 ? "neutral" : "primary"}
                  />
                  <MetricCard label="Cases" value={String(policy.n_cases)} icon={ShieldCheck} />
                  <MetricCard
                    label="False allows"
                    value={String(policy.false_allow_count)}
                    icon={ShieldAlert}
                    accent={policy.false_allow_count > 0 ? "neutral" : "primary"}
                  />
                  <MetricCard label="False blocks" value={String(policy.false_block_count)} icon={ShieldAlert} />
                </div>
                {policy.false_allow_count > 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    {policy.false_allow_count} case(s) that should have been blocked returned evidence anyway:{" "}
                    {policy.false_allow_cases.join(", ")} — treat as a security regression, not just a metric dip.
                  </div>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-text-faint">{policy.caveat}</p>
              </>
            )}
          </div>

          <div>
            <p className="mb-3 text-[12px] font-medium text-text-faint">
              From the existing evaluation harness (read-only — run a full benchmark on the Evaluation page to refresh)
            </p>
            {!summary?.quality_available ? (
              <p className="text-[13px] text-text-muted">No full benchmark has been run yet — see the Evaluation page.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard label="Citation precision" value={pct(summary.quality?.citation_precision)} icon={Brain} />
                <MetricCard label="Faithfulness" value={pct(summary.quality?.mean_faithfulness)} icon={Brain} />
                <MetricCard label="Abstention accuracy" value={pct(summary.quality?.abstention_accuracy)} icon={Brain} />
                <MetricCard label="Unsupported-claim rate" value={pct(summary.quality?.unsupported_claim_rate)} icon={Brain} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
