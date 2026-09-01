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
    <div className="rounded-xl border border-border-subtle bg-surface/60 p-4 transition-colors hover:border-border">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-text-faint">{label}</span>
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md",
            accent === "primary" && "bg-primary-dim/40 text-primary",
            accent === "evidence" && "bg-evidence-dim/40 text-evidence",
            accent === "neutral" && "bg-elevated-2 text-text-faint"
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tracking-tight text-text">
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "text-[11px] font-medium",
              deltaTone === "positive" && "text-success",
              deltaTone === "negative" && "text-error",
              deltaTone === "neutral" && "text-text-faint"
            )}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
