"use client";

/**
 * Real-state Knowledge Core for the Copilot page itself.
 *
 * Scope note (Phase 4 spec section 7): the dashboard's `KnowledgeCorePanel`
 * stays on its existing demo timer cycle rather than being wired to
 * cross-page live state -- true cross-page state sharing (a query in
 * flight on /copilot updating the orb rendered on /) would need a
 * shared client-side store or a second SSE subscription mounted on the
 * dashboard, which is out of scope for this phase. This component gives
 * the Copilot page its *own* orb driven by real `/chat` SSE status
 * events, which is the explicitly-allowed scoped-down option the spec
 * itself offers.
 */

import { Component, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { CoreState } from "@/components/three/knowledge-core";
import type { CopilotStage } from "@/lib/api";
import { cn } from "@/lib/utils";

const KnowledgeCore = dynamic(
  () => import("@/components/three/knowledge-core").then((m) => m.KnowledgeCore),
  { ssr: false }
);

const STAGE_TO_CORE_STATE: Record<CopilotStage, CoreState> = {
  understanding_query: "searching",
  retrieving_evidence: "retrieving",
  reasoning: "reasoning",
  generating: "generating",
  validating: "generating",
};

const STAGE_LABEL: Record<CopilotStage, string> = {
  understanding_query: "Understanding query",
  retrieving_evidence: "Retrieving evidence",
  reasoning: "Reasoning over passages",
  generating: "Grounded generation",
  validating: "Validating citations",
};

class Canvas3DBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

function StaticFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative h-32 w-32 rounded-full border border-primary/30">
        <div className="absolute inset-4 rounded-full border border-evidence/25" />
        <div className="absolute inset-8 rounded-full bg-primary/10" />
      </div>
    </div>
  );
}

export function CopilotCorePanel({ stage }: { stage: CopilotStage | null }) {
  const [webgl] = useState<boolean>(() => hasWebGL());
  const coreState: CoreState = stage ? STAGE_TO_CORE_STATE[stage] : "idle";

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface/60">
      <div className="flex items-center justify-between px-5 pt-5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-text-faint">
            This exchange
          </p>
          <p className="mt-1 font-display text-sm font-medium text-text">Knowledge Core</p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-medium",
            coreState === "generating"
              ? "bg-evidence-dim/40 text-evidence"
              : stage
                ? "bg-primary-dim/40 text-primary"
                : "bg-elevated-2 text-text-faint"
          )}
        >
          {stage ? STAGE_LABEL[stage] : "Idle"}
        </span>
      </div>

      <div className="relative flex-1">
        {webgl ? (
          <Canvas3DBoundary fallback={<StaticFallback />}>
            <KnowledgeCore state={coreState} />
          </Canvas3DBoundary>
        ) : (
          <StaticFallback />
        )}
      </div>

      <div className="px-5 pb-5 text-[11px] text-text-faint">
        Driven by real `/chat` SSE status events for this exchange — not a demo cycle.
      </div>
    </div>
  );
}
