"use client";

import { Search, Bell, CircleUser, Sparkles, Terminal } from "lucide-react";

export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle/80 bg-surface/60 backdrop-blur-xl px-6 relative z-10">
      {/* Left: Zero-G Telemetry HUD cluster */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-elevated/70 px-3 py-1 shadow-[0_0_15px_rgba(79,209,197,0.06)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success shadow-[0_0_6px_rgba(110,231,168,0.8)]" />
          </span>
          <span className="font-mono text-[11px] font-bold text-text-muted tracking-tight">
            ZERO-G RUNTIME ACTIVE
          </span>
        </div>

        <div className="hidden md:flex items-center gap-2 font-mono text-[10px] text-text-faint">
          <span className="rounded border border-evidence/20 bg-evidence/8 px-2 py-0.5 text-evidence font-medium">
            ORBIT: SYNCHRONIZED
          </span>
          <span className="hidden xl:inline text-text-faint/60">·</span>
          <span className="hidden xl:inline text-text-faint">
            LATENCY: <span className="text-text-muted">14ms</span>
          </span>
        </div>
      </div>

      {/* Right: Quick actions & user info */}
      <div className="flex items-center gap-3">
        <button
          className="group flex items-center gap-2.5 rounded-xl border border-white/10 bg-elevated/50 backdrop-blur-md px-3.5 py-1.5 text-[12px] text-text-muted hover:text-text hover:border-evidence/40 hover:shadow-[0_0_15px_rgba(79,209,197,0.12)] transition-all duration-200"
          aria-label="Search"
        >
          <Search className="h-3.5 w-3.5 text-text-faint group-hover:text-evidence transition-colors" />
          <span>Quick command search</span>
          <kbd className="ml-2 rounded border border-white/10 bg-elevated-2/80 px-1.5 py-0.5 font-mono text-[10px] text-text-faint group-hover:text-text-muted">
            ⌘K
          </kbd>
        </button>

        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-elevated/40 text-text-faint hover:text-text hover:bg-elevated hover:border-white/15 transition-all"
          aria-label="Notifications"
        >
          <Bell className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(240,168,87,0.8)]" />
        </button>

        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-elevated/40 text-text-muted hover:text-text hover:border-evidence/40 hover:shadow-[0_0_12px_rgba(79,209,197,0.2)] transition-all"
          aria-label="Account"
        >
          <CircleUser className="h-4.5 w-4.5" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
