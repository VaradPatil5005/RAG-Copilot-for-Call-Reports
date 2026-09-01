"use client";

import { Search, Bell, CircleUser } from "lucide-react";

export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle bg-surface/40 backdrop-blur-sm px-6">
      <div className="flex items-center gap-2 text-text-faint">
        <div className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-elevated/50 px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="text-[11px] font-medium text-text-muted">
            All systems operational
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="flex items-center gap-2 rounded-lg border border-border-subtle bg-elevated/40 px-3 py-1.5 text-[13px] text-text-faint hover:text-text-muted hover:border-border transition-colors"
          aria-label="Search"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Quick search</span>
          <kbd className="ml-2 rounded border border-border-subtle bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
            ⌘K
          </kbd>
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-faint hover:text-text-muted hover:bg-elevated/50 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-faint hover:text-text-muted hover:bg-elevated/50 transition-colors"
          aria-label="Account"
        >
          <CircleUser className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
