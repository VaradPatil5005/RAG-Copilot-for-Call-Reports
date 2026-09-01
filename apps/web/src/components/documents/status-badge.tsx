import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/lib/api";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Copy, Clock } from "lucide-react";

const ACTIVE_STAGES: DocumentStatus[] = [
  "validating",
  "extracting",
  "multimodal_extraction",
  "normalizing",
  "chunking",
  "embedding",
  "indexing",
  "graph_extraction",
];

const CONFIG: Record<
  DocumentStatus,
  { label: string; icon: typeof Loader2; className: string; spin?: boolean }
> = {
  queued: {
    label: "Queued",
    icon: Clock,
    className: "bg-elevated-2 text-text-faint border-border-subtle",
  },
  validating: {
    label: "Validating",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  extracting: {
    label: "Extracting layout",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  multimodal_extraction: {
    label: "Routing multimodal",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  normalizing: {
    label: "Normalizing",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  chunking: {
    label: "Chunking",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  embedding: {
    label: "Embedding",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  indexing: {
    label: "Indexing",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  graph_extraction: {
    label: "Extracting graph",
    icon: Loader2,
    className: "bg-primary-dim/30 text-primary border-primary-dim/60",
    spin: true,
  },
  completed: {
    label: "Indexed",
    icon: CheckCircle2,
    className: "bg-evidence-dim/30 text-evidence border-evidence-dim/60",
  },
  failed: {
    label: "Failed",
    icon: AlertTriangle,
    className: "bg-error/15 text-error border-error/40",
  },
  dead_lettered: {
    label: "Dead-lettered",
    icon: XCircle,
    className: "bg-error/15 text-error border-error/40",
  },
  quarantined: {
    label: "Quarantined",
    icon: AlertTriangle,
    className: "bg-warning/15 text-warning border-warning/40",
  },
  duplicate: {
    label: "Duplicate",
    icon: Copy,
    className: "bg-elevated-2 text-text-muted border-border-subtle",
  },
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const cfg = CONFIG[status] ?? CONFIG.queued;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        cfg.className
      )}
    >
      <Icon className={cn("h-3 w-3", cfg.spin && "animate-spin")} strokeWidth={2} />
      {cfg.label}
    </span>
  );
}

export function isActiveStatus(status: DocumentStatus): boolean {
  return ACTIVE_STAGES.includes(status) || status === "queued";
}
