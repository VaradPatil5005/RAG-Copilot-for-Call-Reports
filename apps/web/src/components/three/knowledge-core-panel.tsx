"use client";

import { useEffect, useState, Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { CoreState } from "./knowledge-core";
import { cn } from "@/lib/utils";

const KnowledgeCore = dynamic(
  () => import("./knowledge-core").then((m) => m.KnowledgeCore),
  { ssr: false }
);

const CYCLE: { state: CoreState; label: string }[] = [
  { state: "idle", label: "Idle" },
  { state: "searching", label: "Understanding query" },
  { state: "retrieving", label: "Retrieving evidence" },
  { state: "reasoning", label: "Reasoning over passages" },
  { state: "generating", label: "Grounded generation" },
];

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
      <div className="relative h-40 w-40 rounded-full border border-primary/30">
        <div className="absolute inset-4 rounded-full border border-evidence/25" />
        <div className="absolute inset-10 rounded-full bg-primary/10" />
      </div>
    </div>
  );
}

export function KnowledgeCorePanel() {
  const [idx, setIdx] = useState(0);
  // Safe to call eagerly: this component is only ever mounted client-side
  // (see the dynamic ssr:false import in dashboard usage).
  const [webgl] = useState<boolean>(() => hasWebGL());

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % CYCLE.length);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  const current = CYCLE[idx];

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface/60">
      <div className="flex items-center justify-between px-5 pt-5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-text-faint">
            Copilot activity
          </p>
          <p className="mt-1 font-display text-sm font-medium text-text">
            AI Knowledge Core
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-medium",
            current.state === "generating"
              ? "bg-evidence-dim/40 text-evidence"
              : "bg-primary-dim/40 text-primary"
          )}
        >
          {current.label}
        </span>
      </div>

      <div className="relative flex-1">
        {webgl ? (
          <Canvas3DBoundary fallback={<StaticFallback />}>
            <KnowledgeCore state={current.state} />
          </Canvas3DBoundary>
        ) : (
          <StaticFallback />
        )}
      </div>

      <div className="px-5 pb-5 text-[11px] text-text-faint">
        Reacts to retrieval state — amber during search/reasoning, teal once an
        answer is grounded in verified evidence.
      </div>
    </div>
  );
}
