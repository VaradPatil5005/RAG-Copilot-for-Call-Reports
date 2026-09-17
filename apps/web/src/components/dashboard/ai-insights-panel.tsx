"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  RefreshCw,
  FileText,
  User,
  Calendar,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAIInsights, type AIInsightItem } from "@/lib/api";

type CategoryFilter = "all" | "risk" | "action" | "market";

export function AIInsightsPanel() {
  const [insights, setInsights] = useState<AIInsightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CategoryFilter>("all");

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const data = await getAIInsights();
      setInsights(data.insights || []);
    } catch (err) {
      console.error("Failed to load AI insights:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchInsights, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredInsights = insights.filter((item) => {
    if (filter === "all") return true;
    return item.type === filter;
  });

  const riskCount = insights.filter((i) => i.type === "risk").length;
  const actionCount = insights.filter((i) => i.type === "action").length;
  const marketCount = insights.filter((i) => i.type === "market").length;

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0A0E18]/80 backdrop-blur-2xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)] hover:border-white/10 transition-all h-[460px]">
      {/* Top Specular Laser Line */}
      <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 border border-primary/25 text-primary shadow-[0_0_12px_rgba(240,168,87,0.2)]">
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div>
            <p className="font-display text-sm font-semibold text-text">AI Insights</p>
            <p className="font-mono text-[10px] text-text-faint uppercase tracking-wider">
              Cross-Report Synthesis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-evidence bg-evidence/10 border border-evidence/25 rounded-full px-2.5 py-0.5">
            <Radio className="h-2.5 w-2.5 animate-pulse" />
            LIVE
          </span>
          <button
            onClick={fetchInsights}
            disabled={loading}
            title="Refresh Insights"
            className="p-1.5 rounded-lg border border-border-subtle hover:bg-elevated text-text-faint hover:text-text transition cursor-pointer"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 pt-3 pb-3 border-b border-border-subtle/30 overflow-x-auto">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition cursor-pointer",
            filter === "all"
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-text-muted hover:text-text hover:bg-elevated/50"
          )}
        >
          All ({insights.length})
        </button>
        <button
          onClick={() => setFilter("risk")}
          className={cn(
            "px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition cursor-pointer",
            filter === "risk"
              ? "bg-error/20 text-error border border-error/30"
              : "text-text-muted hover:text-text hover:bg-elevated/50"
          )}
        >
          Risks ({riskCount})
        </button>
        <button
          onClick={() => setFilter("action")}
          className={cn(
            "px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition cursor-pointer",
            filter === "action"
              ? "bg-evidence/20 text-evidence border border-evidence/30"
              : "text-text-muted hover:text-text hover:bg-elevated/50"
          )}
        >
          Actions ({actionCount})
        </button>
        <button
          onClick={() => setFilter("market")}
          className={cn(
            "px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition cursor-pointer",
            filter === "market"
              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
              : "text-text-muted hover:text-text hover:bg-elevated/50"
          )}
        >
          Market ({marketCount})
        </button>
      </div>

      {/* Insight Items List */}
      <div className="flex-1 overflow-y-auto space-y-3 pt-3 pr-1">
        {filteredInsights.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center text-text-muted">
            <p className="text-[13px] font-medium">No insights match this filter</p>
            <p className="text-[11px] text-text-faint mt-1">
              Select another category to view extracted signals.
            </p>
          </div>
        ) : (
          filteredInsights.map((item, idx) => (
            <div
              key={item.id ? `${item.id}-${idx}` : `insight-${idx}`}
              className="group rounded-xl border border-white/6 bg-elevated/40 hover:bg-elevated/70 p-3.5 transition-all duration-200 hover:border-white/12"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {item.type === "risk" && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-error/15 text-error border border-error/25">
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {item.type === "action" && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-evidence/15 text-evidence border border-evidence/25">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {item.type === "market" && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/25">
                      <TrendingUp className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <div>
                    <h4 className="font-display text-[13px] font-semibold text-text leading-tight group-hover:text-white transition-colors">
                      {item.title}
                    </h4>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint">
                      {item.category}
                    </span>
                  </div>
                </div>

                <span
                  className={cn(
                    "shrink-0 font-mono text-[9px] font-bold uppercase rounded-full px-2 py-0.5 border",
                    item.severity === "high" &&
                      "bg-error/10 text-error border-error/25",
                    item.severity === "medium" &&
                      "bg-primary/10 text-primary border-primary/25",
                    (item.severity === "low" || item.severity === "info") &&
                      "bg-evidence/10 text-evidence border-evidence/25"
                  )}
                >
                  {item.severity}
                </span>
              </div>

              <p className="mt-2 text-[12px] text-text-muted leading-relaxed">
                {item.description}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-2 border-t border-border-subtle/20 font-mono text-[10px] text-text-faint">
                <span className="bg-surface/60 rounded px-1.5 py-0.5 text-text-muted font-medium">
                  {item.customer}
                </span>

                {item.owner && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3 text-text-faint" />
                    {item.owner}
                  </span>
                )}

                {item.due_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-text-faint" />
                    {item.due_date}
                  </span>
                )}

                <Link
                  href={`/documents`}
                  className="ml-auto flex items-center gap-1 text-text-faint hover:text-evidence transition"
                >
                  <FileText className="h-3 w-3" />
                  <span className="truncate max-w-[130px]">{item.source_document}</span>
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
