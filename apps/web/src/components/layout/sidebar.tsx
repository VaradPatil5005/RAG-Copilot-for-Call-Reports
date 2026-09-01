"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/config/nav";
import { cn } from "@/lib/utils";
import { Radar } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border-subtle bg-surface/60 backdrop-blur-sm">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border-subtle">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-elevated-2">
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

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition-colors",
                active
                  ? "bg-elevated text-text"
                  : "text-text-muted hover:bg-elevated/60 hover:text-text"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-primary" : "text-text-faint group-hover:text-text-muted"
                )}
                strokeWidth={1.75}
              />
              <span className="font-medium">{item.label}</span>
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <div className="rounded-lg border border-border-subtle bg-elevated/40 px-3 py-3">
          <p className="text-[11px] text-text-faint leading-relaxed">
            Local dev mode — Azure services are mocked. See{" "}
            <code className="font-mono text-[10px] text-text-muted">docs/decisions</code>{" "}
            for the substitution map.
          </p>
        </div>
      </div>
    </aside>
  );
}
