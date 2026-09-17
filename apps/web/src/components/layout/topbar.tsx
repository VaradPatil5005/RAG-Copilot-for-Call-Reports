"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Search, LogIn, Glasses } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { cn } from "@/lib/utils";

export function Topbar() {
  const pathname = usePathname();
  const { role, isAuthenticated, openAuthModal, isIncognito, toggleIncognito } = useAuth();
  const isCopilot = pathname === "/copilot";

  const planBadgeText =
    role === "super_admin"
      ? "Super Admin · Platform Core"
      : isAuthenticated
      ? "Institutional Suite · All Features Active"
      : "Free Discovery · Sign In";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#06080F]/90 backdrop-blur-md px-6 relative z-10 select-none">
      {/* Left: Perplexity-style Plan Chip */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (!isAuthenticated) openAuthModal("Upgrade to Institutional Plan");
          }}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-border bg-surface/80 hover:border-evidence/40 text-[12px] text-text-muted hover:text-white transition-all cursor-pointer"
        >
          <span className="font-medium text-white">{planBadgeText.split("·")[0].trim()}</span>
          {planBadgeText.includes("·") && (
            <>
              <span className="text-[#52525b]">·</span>
              <span className="text-text-faint">{planBadgeText.split("·")[1].trim()}</span>
            </>
          )}
        </button>

        {/* Incognito badge shown ONLY when in Copilot */}
        {isCopilot && isIncognito && (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-evidence/40 bg-evidence/10 text-evidence text-[11px] font-mono font-medium shadow-[0_0_10px_rgba(79,209,197,0.25)] animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_6px_rgba(79,209,197,0.8)]" />
            <span>INCOGNITO ACTIVE</span>
          </div>
        )}
      </div>

      {/* Right: Controls & Scoped Incognito Switch */}
      <div className="flex items-center gap-2">
        <button
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface/60 hover:bg-elevated text-[12px] text-text-faint hover:text-white transition-colors cursor-pointer"
          onClick={() => {
            const input = document.querySelector('textarea, input[type="text"]') as HTMLElement;
            input?.focus();
          }}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Ask anything</span>
          <kbd className="text-[10px] font-mono text-text-faint border border-border-subtle rounded px-1">
            /
          </kbd>
        </button>

        {/* Incognito Quick Toggle: VISIBLE ONLY ON COPILOT */}
        {isCopilot && (
          <button
            onClick={toggleIncognito}
            title={isIncognito ? "Incognito Session Active · Click to exit" : "Switch to Incognito Session"}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] transition-all cursor-pointer border",
              isIncognito
                ? "bg-evidence/15 text-evidence border-evidence/40 shadow-[0_0_12px_rgba(79,209,197,0.3)]"
                : "text-text-muted hover:text-white hover:bg-elevated/60 border-transparent"
            )}
          >
            <Glasses className="h-4 w-4" />
            <span className="font-mono text-[11px] font-medium hidden md:inline">
              Incognito
            </span>
          </button>
        )}

        {!isAuthenticated && (
          <button
            onClick={() => openAuthModal("Sign in to your institutional account")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-[12px] font-medium text-white transition-colors cursor-pointer"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Sign in</span>
          </button>
        )}
      </div>
    </header>
  );
}
