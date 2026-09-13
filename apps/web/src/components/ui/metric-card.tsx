import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  accent?: "primary" | "evidence" | "neutral";
}

export function MetricCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  icon: Icon,
  accent = "neutral",
}: MetricCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/8 bg-surface/70 backdrop-blur-xl p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all duration-300 hover:border-white/16 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.6)] hover:-translate-y-0.5">
      {/* Subtle corner aura */}
      <div
        className={cn(
          "pointer-events-none absolute -top-12 -right-12 h-28 w-28 rounded-full blur-2xl transition-opacity duration-300 opacity-40 group-hover:opacity-70",
          accent === "primary" && "bg-primary/30",
          accent === "evidence" && "bg-evidence/30",
          accent === "neutral" && "bg-white/10"
        )}
      />

      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-medium tracking-wider uppercase text-text-faint">
          {label}
        </span>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl border transition-all duration-300",
            accent === "primary" &&
              "border-primary/30 bg-primary/10 text-primary shadow-[0_0_12px_rgba(240,168,87,0.2)]",
            accent === "evidence" &&
              "border-evidence/30 bg-evidence/10 text-evidence shadow-[0_0_12px_rgba(79,209,197,0.2)]",
            accent === "neutral" &&
              "border-white/8 bg-elevated-2/80 text-text-muted group-hover:text-text"
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2.5">
        <span className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-text group-hover:text-white transition-colors">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "font-mono rounded-full px-2 py-0.5 text-[10px] font-bold border",
              deltaTone === "positive" &&
                "border-success/30 bg-success/10 text-success shadow-[0_0_8px_rgba(110,231,168,0.2)]",
              deltaTone === "negative" &&
                "border-error/30 bg-error/10 text-error shadow-[0_0_8px_rgba(240,104,92,0.2)]",
              deltaTone === "neutral" &&
                "border-white/8 bg-elevated/60 text-text-faint"
            )}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
