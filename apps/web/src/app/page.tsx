import { PageHeader } from "@/components/ui/page-header";
import { KnowledgeCoreLoader } from "@/components/three/knowledge-core-loader";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { PipelineStatusPanel } from "@/components/dashboard/pipeline-status";
import { SystemHealthPanel } from "@/components/dashboard/system-health-panel";
import { TrendingUp } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Command center"
        title="Overview"
        description="Enterprise call-report intelligence — ingestion health, retrieval quality, and Copilot activity at a glance."
      />

      <OverviewMetrics />

      <div className="mt-6 grid grid-cols-1 gap-4 px-8 lg:grid-cols-3">
        <PipelineStatusPanel />

        <div className="h-[380px] lg:h-auto">
          <KnowledgeCoreLoader />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 px-8 lg:grid-cols-2">
        <div className="rounded-xl border border-border-subtle bg-surface/60 p-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" strokeWidth={1.75} />
            <p className="font-display text-sm font-medium text-text">AI Insights</p>
          </div>
          <div className="mt-4 flex flex-col items-center justify-center gap-2 py-8 text-center">
            <p className="text-[13px] text-text-muted">No insights generated yet</p>
            <p className="text-[12px] text-text-faint max-w-xs">
              Emerging risks, competitor mentions, and pipeline changes will surface here once
              retrieval and the Copilot (Phase 3–4) are online.
            </p>
          </div>
        </div>

        <SystemHealthPanel />
      </div>
    </div>
  );
}
