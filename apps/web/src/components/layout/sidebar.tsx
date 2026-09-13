"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/config/nav";
import { cn } from "@/lib/utils";
import { Activity, Radar } from "lucide-react";

// Categorized navigation groups for Google Antigravity aesthetic
const NAV_GROUPS = [
  {
    label: "COGNITION & RETRIEVAL",
    hrefs: ["/", "/copilot", "/search", "/documents"],
  },
  {
    label: "KNOWLEDGE & REASONING",
    hrefs: ["/graph", "/decision-eval"],
  },
  {
    label: "AGENTIC TELEMETRY",
    hrefs: ["/learning", "/evaluation", "/observability", "/admin"],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-border-subtle bg-surface/80 backdrop-blur-xl relative z-20">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-border-subtle/80 bg-surface/50">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated-2">
          <Radar className="h-4 w-4 text-primary" strokeWidth={2} />
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-evidence animate-pulse" />
        </div>
        <div className="leading-tight">
          <p className="font-display text-[13px] font-semibold tracking-tight text-text">
            Call Report Copilot
          </p>
          <p className="text-[11px] text-text-faint">Enterprise RAG</p>
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {NAV_GROUPS.map((group) => {
          const items = group.hrefs
            .map((href) => NAV_ITEMS.find((n) => n.href === href))
            .filter(Boolean);

          return (
            <div key={group.label} className="space-y-1">
              <p className="px-3 pb-1 text-[10px] font-mono font-bold tracking-widest text-text-faint/70 uppercase">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  if (!item) return null;
                  const active =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname?.startsWith(item.href);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200 border",
                        active
                          ? "bg-gradient-to-r from-elevated-2 to-elevated text-text border-white/10 shadow-[0_0_20px_rgba(79,209,197,0.06)]"
                          : "text-text-muted border-transparent hover:bg-elevated/50 hover:text-text hover:border-white/5"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                          active
                            ? "bg-evidence/15 text-evidence shadow-[0_0_12px_rgba(79,209,197,0.3)]"
                            : "text-text-faint group-hover:text-text-muted group-hover:bg-elevated/60"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2 : 1.75} />
                      </div>
                      <span className="truncate">{item.label}</span>
                      {active && (
                        <div className="ml-auto flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_8px_rgba(79,209,197,0.9)]" />
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Antigravity Runtime Telemetry Footer */}
      <div className="px-3 pb-4">
        <div className="rounded-xl border border-white/8 bg-elevated/50 backdrop-blur-md p-3 shadow-inner">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-evidence" strokeWidth={2} />
              <span className="font-mono text-[10px] font-bold text-text tracking-wider uppercase">
                Zero-G Core
              </span>
            </div>
            <span className="flex items-center gap-1 font-mono text-[9px] text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              ONLINE
            </span>
          </div>
          <p className="font-mono text-[10px] text-text-faint leading-relaxed">
            Mesh: <span className="text-text-muted">Quantum-10</span> · Tenant:{" "}
            <span className="text-evidence">Authorized</span>
          </p>
        </div>
      </div>
    </aside>
  );
}
