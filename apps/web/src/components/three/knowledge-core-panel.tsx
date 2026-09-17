"use client";

import { useEffect, useState, Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  type CoreState,
  AnimatedOrbFallback,
  isWebGLAvailable,
} from "./knowledge-core";
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

export function KnowledgeCorePanel() {
  const [idx, setIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [webgl, setWebgl] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWebgl(isWebGLAvailable());
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % CYCLE.length);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  const current = CYCLE[idx];

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0A0E18]/80 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] hover:border-white/10 transition-all">
      {/* Top Specular Laser Line */}
      <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      
      {/* Ambient Radial Core Aura */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl opacity-50" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-evidence/15 blur-3xl opacity-50" />

      <div className="flex items-center justify-between px-6 pt-6 relative z-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(240,168,87,0.9)] animate-pulse" />
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              SYS.CORE // NEURAL MATRIX
            </p>
          </div>
          <p className="mt-1 font-display text-base font-bold text-white tracking-tight">
            Cognitive Knowledge Core
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition-all duration-300",
            current.state === "generating"
              ? "border border-evidence/40 bg-evidence/15 text-evidence shadow-[0_0_12px_rgba(79,209,197,0.3)]"
              : "border border-primary/40 bg-primary/15 text-primary shadow-[0_0_12px_rgba(240,168,87,0.3)]"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full animate-pulse",
              current.state === "generating" ? "bg-evidence" : "bg-primary"
            )}
          />
          {current.label}
        </span>
      </div>

      <div className="relative flex-1 min-h-[200px]">
        {mounted && webgl ? (
          <Canvas3DBoundary fallback={<AnimatedOrbFallback state={current.state} />}>
            <KnowledgeCore state={current.state} />
          </Canvas3DBoundary>
        ) : (
          <AnimatedOrbFallback state={current.state} />
        )}
      </div>

      <div className="px-6 pb-5 relative z-10 flex items-center justify-between text-[11px] text-zinc-400 border-t border-white/[0.04] pt-3">
        <span className="font-mono text-[10px] text-zinc-500">Autonomous synthesis</span>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-[10px] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_4px_#F0A857]" />
            Reasoning
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] text-evidence">
            <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_4px_#4FD1C5]" />
            Grounded
          </span>
        </div>
      </div>
    </div>
  );
}
