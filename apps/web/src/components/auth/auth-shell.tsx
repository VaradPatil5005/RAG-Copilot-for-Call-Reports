import { BrandLockup, BrandMark } from "@/components/ui/brand";

/**
 * Split editorial layout for sign-in / sign-up / verification.
 * Left: a burnt-orange panel with large ivory display type (the
 * reference's "Creative Journal" treatment). Right: the form on soft
 * black. The panel is hidden below `lg`, where the form stands alone.
 */
export function AuthShell({
  children,
  headline = "Decisions, grounded in every call.",
}: {
  children: React.ReactNode;
  headline?: string;
}) {
  return (
    <div className="grid min-h-screen w-full lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-brand-fill text-paper lg:flex lg:flex-col lg:justify-between p-12 xl:p-16">
        {/* soft-black sun motif, echoing the reference's arched shapes */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -bottom-40 h-[34rem] w-[34rem] rounded-full border border-paper/15"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 h-[24rem] w-[24rem] rounded-full bg-[#101010]/90"
        />
        <div className="relative z-10 flex items-center gap-3">
          <BrandMark variant="onOrange" className="h-8 w-8" />
          <span className="wordmark text-[13px] text-paper">
            Tathyx<span className="text-[#101010]">.</span>
          </span>
        </div>

        <div className="relative z-10 max-w-xl">
          <p className="eyebrow mb-6 text-paper">Decision intelligence for call reports</p>
          <h2 className="font-display text-[3.4rem] xl:text-[4.2rem] font-medium leading-[0.98] tracking-[-0.025em]">
            {headline}
          </h2>
          <p className="mt-7 max-w-md text-[15px] leading-relaxed text-paper">
            Every answer cites the exact page it came from. Every report stays inside your organisation.
          </p>
        </div>

        <dl className="relative z-10 grid max-w-md grid-cols-3 gap-6 border-t border-paper/25 pt-6">
          {[
            ["Page-level", "citations"],
            ["Tenant", "isolation"],
            ["Audit", "trail"],
          ].map(([a, b]) => (
            <div key={a}>
              <dt className="font-display text-[1.15rem] leading-tight">{a}</dt>
              <dd className="eyebrow mt-1 text-paper">{b}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <main className="relative flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[26rem]">
          <div className="mb-10 lg:hidden">
            <BrandLockup size="md" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
