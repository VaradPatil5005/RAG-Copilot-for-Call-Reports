import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentsWorkspace } from "@/components/documents/documents-workspace";

export default function DocumentsPage() {
  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Document center"
        title="Documents"
        description="Upload, track, and inspect call reports as they move through validation, layout extraction, and normalization."
      />
      <Suspense fallback={null}>
        <DocumentsWorkspace />
      </Suspense>
    </div>
  );
}
