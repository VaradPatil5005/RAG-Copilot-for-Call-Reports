import type { LucideIcon } from "lucide-react";

export function PhaseStub({
  icon: Icon,
  phase,
  items,
}: {
  icon: LucideIcon;
  phase: string;
  items: string[];
}) {
  return (
    <div className="mx-8 rounded-xl border border-dashed border-border-subtle bg-surface/40 p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-elevated-2 text-text-faint">
          <Icon className="h-4.5 w-4.5" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-text-faint">
            {phase}
          </p>
          <p className="font-display text-sm font-medium text-text">
            Scoped, not yet built
          </p>
        </div>
      </div>
      <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-[13px] text-text-muted"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-faint" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
