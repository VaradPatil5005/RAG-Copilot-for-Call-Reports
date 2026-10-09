import { cn } from "@/lib/utils";

/**
 * Tathyx brand mark -- "the cited T". A geometric T (Tathyx) with a dot set
 * at its top-right like a footnote marker: tathya means "fact", and every
 * fact in the product carries a citation. The dot is also the full stop of
 * the "TATHYX." wordmark. Drawn on a 64-unit grid, flat colours only.
 * Source files: public/brand/*.svg (favicon: src/app/icon.svg).
 */
const T_PATH =
  "M12 18a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-8v24a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V24h-8a2 2 0 0 1-2-2z";

const MARK_COLORS = {
  // burnt-orange tile, ivory T, soft-black citation dot
  brand: { tile: "#D5360C", t: "#E6D5BD", dot: "#101010" },
  // for use on burnt-orange surfaces
  onOrange: { tile: "#E6D5BD", t: "#D5360C", dot: "#101010" },
} as const;

export function BrandMark({
  className,
  variant = "brand",
}: {
  className?: string;
  variant?: keyof typeof MARK_COLORS;
}) {
  const c = MARK_COLORS[variant];
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("h-7 w-7 shrink-0", className)}>
      <rect width="64" height="64" rx="14" fill={c.tile} />
      <path d={T_PATH} fill={c.t} />
      <circle cx="48" cy="20" r="5" fill={c.dot} />
    </svg>
  );
}

export function Wordmark({ className, size = "sm" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "text-[12px]", md: "text-[14px]", lg: "text-[18px]" };
  return (
    <span className={cn("wordmark text-text", sizes[size], className)}>
      Tathyx<span className="wordmark-dot">.</span>
    </span>
  );
}

export function BrandLockup({
  className,
  size = "sm",
  showMark = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showMark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="Tathyx">
      {showMark && <BrandMark className={size === "lg" ? "h-9 w-9 text-[22px] rounded-[9px]" : undefined} />}
      <Wordmark size={size} />
    </span>
  );
}
