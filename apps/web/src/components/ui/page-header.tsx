export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="relative px-8 pt-7 pb-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          {eyebrow && (
            <div className="mb-2 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_6px_rgba(79,209,197,0.8)]" />
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-faint">
                SYS // {eyebrow}
              </p>
            </div>
          )}
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-muted">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {/* Subtle tech accent divider */}
      <div className="mt-5 h-[1px] w-full bg-gradient-to-r from-white/10 via-border-subtle to-transparent" />
    </div>
  );
}
