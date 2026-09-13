"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  MousePointerClick,
  BookOpen,
  Check,
  X,
  Loader2,
  RefreshCw,
  Sliders,
  Award,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import {
  getLearningStatus,
  getLearnedLexicon,
  updateLearnedLexiconStatus,
  getGoldenExemplars,
  getChunkUtilityScores,
  type LearningStatus,
  type LearnedLexiconItem,
  type GoldenExemplar,
  type ChunkUtilityScore,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function LearningPage() {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [lexicon, setLexicon] = useState<LearnedLexiconItem[]>([]);
  const [exemplars, setExemplars] = useState<GoldenExemplar[]>([]);
  const [utilityScores, setUtilityScores] = useState<ChunkUtilityScore[]>([]);
  const [activeTab, setActiveTab] = useState<"lexicon" | "utility" | "exemplars">("lexicon");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, lexiconRes, exemplarsRes, utilityRes] = await Promise.all([
        getLearningStatus(),
        getLearnedLexicon(),
        getGoldenExemplars(),
        getChunkUtilityScores(25),
      ]);
      setStatus(statusRes);
      setLexicon(lexiconRes.items);
      setExemplars(exemplarsRes.exemplars);
      setUtilityScores(utilityRes.scores);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load learning state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleLexiconStatusChange = async (termId: number, newStatus: "active" | "rejected") => {
    setUpdatingId(termId);
    try {
      await updateLearnedLexiconStatus(termId, newStatus);
      setLexicon((prev) =>
        prev.map((item) => (item.id === termId ? { ...item, status: newStatus } : item))
      );
    } catch (err) {
      console.error("Failed to update term status", err);
    } finally {
      setUpdatingId(null);
    }
  };

  const satisfactionRate =
    status && status.feedback.total > 0
      ? Math.round((status.feedback.positive / status.feedback.total) * 100)
      : null;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Continuous Adaptation"
        title="Self-Learning & Adaptive Intelligence"
        description="Tracks human feedback, reinforces verified chunk utilities, autonomously mines domain acronyms from reports, and manages golden few-shot exemplars."
        actions={
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3.5 py-2 text-[12px] font-medium text-text-muted transition hover:text-text disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        }
      />

      <div className="px-8 space-y-8">
        {error && (
          <div className="rounded-lg border border-error/40 bg-error/10 p-4 text-[13px] text-error">
            {error}
          </div>
        )}

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Human Satisfaction"
            value={satisfactionRate !== null ? `${satisfactionRate}%` : "—"}
            delta={`${status?.feedback.positive ?? 0} helpful · ${status?.feedback.negative ?? 0} issues`}
            deltaTone="positive"
            accent="evidence"
            icon={ThumbsUp}
          />
          <MetricCard
            label="Citation Deep-Links"
            value={status ? status.feedback.citation_clicks.toLocaleString() : "—"}
            delta="Page verifications"
            icon={MousePointerClick}
          />
          <MetricCard
            label="Discovered Jargon"
            value={status ? status.lexicon.total_terms.toString() : "—"}
            delta={`${status?.lexicon.active_terms ?? 0} active terms`}
            accent="primary"
            icon={BookOpen}
          />
          <MetricCard
            label="Few-Shot Exemplars"
            value={status ? status.exemplars_count.toString() : "—"}
            delta="Verified reasoning pairs"
            icon={Award}
          />
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-border-subtle">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab("lexicon")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2",
                activeTab === "lexicon"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              Discovered Lexicon & Acronyms ({lexicon.length})
            </button>
            <button
              onClick={() => setActiveTab("utility")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2",
                activeTab === "utility"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              Adaptive Chunk Utility ({status?.utility.tracked_chunks ?? 0})
            </button>
            <button
              onClick={() => setActiveTab("exemplars")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2",
                activeTab === "exemplars"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              Golden Few-Shot Exemplars ({exemplars.length})
            </button>
          </div>
        </div>

        {/* Tab 1: Learned Lexicon */}
        {activeTab === "lexicon" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-[15px] font-semibold text-text">
                  Self-Discovered Domain Lexicon
                </h2>
                <p className="text-[12px] text-text-muted">
                  Terms and acronyms automatically mined from call report documents to expand user queries during retrieval.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface/50 overflow-hidden">
              <table className="w-full text-left text-[12.5px]">
                <thead className="border-b border-border-subtle bg-elevated/40 text-[11px] font-medium uppercase tracking-wider text-text-faint">
                  <tr>
                    <th className="px-4 py-3">Term / Acronym</th>
                    <th className="px-4 py-3">Expanded Definition</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {lexicon.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-text-faint text-[12px]">
                        No terms discovered yet. Upload a call report with acronym definitions to trigger autonomous discovery.
                      </td>
                    </tr>
                  ) : (
                    lexicon.map((item) => (
                      <tr key={item.id} className="hover:bg-elevated/20 transition-colors">
                        <td className="px-4 py-3 font-semibold uppercase text-text">
                          {item.term}
                        </td>
                        <td className="px-4 py-3 text-text-muted capitalize">
                          {item.expansion}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
                            {item.category.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-evidence">
                          {Math.round(item.confidence * 100)}%
                        </td>
                        <td className="px-4 py-3 text-text-muted font-mono">
                          {item.frequency}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              item.status === "active"
                                ? "bg-evidence-dim/30 text-evidence"
                                : item.status === "rejected"
                                ? "bg-error/20 text-error"
                                : "bg-warning/20 text-warning"
                            )}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status !== "active" && (
                              <button
                                onClick={() => handleLexiconStatusChange(item.id, "active")}
                                disabled={updatingId === item.id}
                                title="Approve term"
                                className="rounded p-1 text-text-faint hover:bg-evidence-dim/20 hover:text-evidence transition"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {item.status !== "rejected" && (
                              <button
                                onClick={() => handleLexiconStatusChange(item.id, "rejected")}
                                disabled={updatingId === item.id}
                                title="Reject term"
                                className="rounded p-1 text-text-faint hover:bg-error/20 hover:text-error transition"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Adaptive Chunk Utility Scores */}
        {activeTab === "utility" && (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-[15px] font-semibold text-text">
                Adaptive Chunk Utility Multipliers
              </h2>
              <p className="text-[12px] text-text-muted">
                Chunks that repeatedly produce verified, human-approved citations receive a positive multiplier (up to 1.30×). Chunks with stripped citations or negative feedback are penalized gracefully.
              </p>
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface/50 overflow-hidden">
              <table className="w-full text-left text-[12.5px]">
                <thead className="border-b border-border-subtle bg-elevated/40 text-[11px] font-medium uppercase tracking-wider text-text-faint">
                  <tr>
                    <th className="px-4 py-3">Chunk ID</th>
                    <th className="px-4 py-3">Utility Multiplier</th>
                    <th className="px-4 py-3">Retrievals</th>
                    <th className="px-4 py-3">Valid Citations</th>
                    <th className="px-4 py-3">Validation Failures</th>
                    <th className="px-4 py-3">Human Feedback (+/-)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {utilityScores.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-text-faint text-[12px]">
                        No chunk utility scores recorded yet. Ask questions in the Copilot to initiate tracking.
                      </td>
                    </tr>
                  ) : (
                    utilityScores.map((score) => {
                      const isBoosted = score.utility_multiplier > 1.05;
                      const isDemoted = score.utility_multiplier < 0.95;
                      return (
                        <tr key={score.chunk_id} className="hover:bg-elevated/20 transition-colors">
                          <td className="px-4 py-3 font-mono text-[11.5px] text-text">
                            {score.chunk_id}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 font-mono font-semibold px-2 py-0.5 rounded text-[11.5px]",
                                isBoosted
                                  ? "bg-evidence-dim/30 text-evidence"
                                  : isDemoted
                                  ? "bg-error/20 text-error"
                                  : "text-text-muted"
                              )}
                            >
                              {score.utility_multiplier.toFixed(2)}×
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-text-muted">{score.retrieval_count}</td>
                          <td className="px-4 py-3 font-mono text-evidence">{score.citation_count}</td>
                          <td className="px-4 py-3 font-mono text-error">{score.citation_failed_count}</td>
                          <td className="px-4 py-3 font-mono text-text-muted">
                            +{score.human_positive_count} / -{score.human_negative_count}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Golden Few-Shot Exemplars */}
        {activeTab === "exemplars" && (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-[15px] font-semibold text-text">
                Dynamic Few-Shot Exemplar Memory
              </h2>
              <p className="text-[12px] text-text-muted">
                High-confidence answers with verified citations and positive human feedback are retained as in-context reference examples for similar complex questions.
              </p>
            </div>

            <div className="space-y-3">
              {exemplars.length === 0 ? (
                <div className="rounded-xl border border-border-subtle bg-surface/50 p-8 text-center text-text-faint text-[12px]">
                  No golden exemplars created yet. When the Copilot produces a high-confidence answer with positive feedback, it will automatically be promoted here.
                </div>
              ) : (
                exemplars.map((ex) => (
                  <div
                    key={ex.exemplar_id}
                    className="rounded-xl border border-border-subtle bg-surface/60 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-primary-dim/30 text-primary border border-primary-dim/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                          {ex.query_category}
                        </span>
                        <p className="text-[13px] font-semibold text-text">{ex.query}</p>
                      </div>
                      <span className="text-[11px] text-text-faint font-mono">
                        {ex.citation_count} citations · {ex.utility_score} utility
                      </span>
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-text-muted bg-elevated/40 p-3 rounded-lg border border-border-subtle font-mono text-[11.5px]">
                      {JSON.stringify(ex.verified_answer_json, null, 2)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
