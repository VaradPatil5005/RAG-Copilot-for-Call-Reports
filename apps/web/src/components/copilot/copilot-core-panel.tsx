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

import { Component, useState, useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  type CoreState,
  AnimatedOrbFallback,
  isWebGLAvailable,
} from "@/components/three/knowledge-core";
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

export function CopilotCorePanel({ stage }: { stage: CopilotStage | null }) {
  const [mounted, setMounted] = useState(false);
  const [webgl, setWebgl] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWebgl(isWebGLAvailable());
  }, []);

  const coreState: CoreState = stage ? STAGE_TO_CORE_STATE[stage] : "idle";

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface/60">
      <div className="flex items-center justify-between px-5 pt-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            This exchange
          </p>
          <p className="mt-0.5 font-display text-xs font-semibold text-text">Knowledge Core</p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-mono font-medium",
            coreState === "generating"
              ? "bg-evidence-dim/40 text-evidence border border-evidence/30"
              : stage
                ? "bg-primary-dim/40 text-primary border border-primary/30"
                : "bg-elevated-2 text-text-faint"
          )}
        >
          {stage ? STAGE_LABEL[stage] : "Idle"}
        </span>
      </div>

      <div className="relative flex-1 min-h-[160px]">
        {mounted && webgl ? (
          <Canvas3DBoundary fallback={<AnimatedOrbFallback state={coreState} />}>
            <KnowledgeCore state={coreState} />
          </Canvas3DBoundary>
        ) : (
          <AnimatedOrbFallback state={coreState} />
        )}
      </div>

      <div className="px-4 pb-3 text-[10px] font-mono text-text-faint">
        Driven by real `/chat` SSE status events for this exchange.
      </div>
    </div>
  );
}
