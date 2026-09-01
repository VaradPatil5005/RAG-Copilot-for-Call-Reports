"use client";

import dynamic from "next/dynamic";

const KnowledgeCorePanel = dynamic(
  () =>
    import("./knowledge-core-panel").then((m) => m.KnowledgeCorePanel),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse rounded-xl border border-border-subtle bg-surface/40" />
    ),
  }
);

export function KnowledgeCoreLoader() {
  return <KnowledgeCorePanel />;
}
