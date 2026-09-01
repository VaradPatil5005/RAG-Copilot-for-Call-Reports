import { PageHeader } from "@/components/ui/page-header";
import { CopilotWorkspace } from "@/components/copilot/copilot-workspace";

export default function CopilotPage() {
  return (
    <div className="pb-4">
      <PageHeader
        eyebrow="AI copilot"
        title="Copilot"
        description="Ask grounded questions across authorized call reports and get page-level, citable answers."
      />
      <CopilotWorkspace />
    </div>
  );
}
