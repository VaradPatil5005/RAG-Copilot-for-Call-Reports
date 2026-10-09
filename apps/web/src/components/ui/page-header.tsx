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
    <header className="relative px-6 sm:px-10 pt-10 pb-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          {eyebrow && (
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-8 bg-brand" aria-hidden="true" />
              <p className="eyebrow text-text-muted">{eyebrow}</p>
            </div>
          )}
          <h1 className="font-display text-[2rem] sm:text-[2.6rem] font-medium leading-[1.05] text-text">
            {title}
          </h1>
          {description && (
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className="mt-8 h-px w-full bg-border-subtle" />
    </header>
  );
}
