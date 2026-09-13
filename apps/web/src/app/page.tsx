import { PageHeader } from "@/components/ui/page-header";
import { KnowledgeCoreLoader } from "@/components/three/knowledge-core-loader";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { PipelineStatusPanel } from "@/components/dashboard/pipeline-status";
import { SystemHealthPanel } from "@/components/dashboard/system-health-panel";
import { AIInsightsPanel } from "@/components/dashboard/ai-insights-panel";

export default function DashboardPage() {
  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Command center"
        title="Overview"
        description="Enterprise call-report intelligence — ingestion health, retrieval quality, and Copilot activity at a glance."
      />

      <OverviewMetrics />

      <div className="mt-6 grid grid-cols-1 gap-5 px-8 lg:grid-cols-3">
        <PipelineStatusPanel />

        <div className="h-[380px] lg:h-auto">
          <KnowledgeCoreLoader />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 px-8 lg:grid-cols-2">
        <AIInsightsPanel />
        <SystemHealthPanel />
      </div>
    </div>
  );
}
