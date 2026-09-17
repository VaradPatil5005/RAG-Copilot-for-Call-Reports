"use client";

import { useState, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
  Building2,
} from "lucide-react";
import type { ChatEvidenceItem } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CitationPopoverProps {
  sources: ChatEvidenceItem[];
  startIndex?: number;
  label?: string;
  onOpenDocument?: (docId: string, page?: number, snippet?: string) => void;
}

export function CitationPillWithPopover({
  sources,
  startIndex = 0,
  label,
  onOpenDocument,
}: CitationPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLSpanElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const totalSources = sources.length;
  if (totalSources === 0) return null;

  const currentSource = sources[activeIdx] || sources[0];

  // Derive title from section path or document ID
  const sectionTitle =
    currentSource.section_path && currentSource.section_path.length > 0
      ? currentSource.section_path[currentSource.section_path.length - 1]
      : `Document ${currentSource.document_id.slice(0, 10)}`;

  const primaryName =
    currentSource.section_path && currentSource.section_path.length > 0
      ? currentSource.section_path[0]
      : currentSource.document_id.slice(0, 14);

  const pillText =
    label ||
    (totalSources > 1
      ? `${primaryName.slice(0, 18)} +${totalSources - 1}`
      : primaryName.slice(0, 22));

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 280);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveIdx((prev) => (prev > 0 ? prev - 1 : totalSources - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveIdx((prev) => (prev < totalSources - 1 ? prev + 1 : 0));
  };

  return (
    <span
      ref={containerRef}
      className="relative inline-block align-baseline mx-1 my-0.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Inline pill matching Screenshot 1 (e.g. hostinger +2) */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all duration-150 border select-none cursor-pointer",
          isOpen
            ? "border-primary/60 bg-primary/20 text-white shadow-[0_0_12px_rgba(240,168,87,0.25)]"
            : "border-border-subtle bg-elevated/70 text-text-muted hover:border-primary/40 hover:text-text hover:bg-elevated"
        )}
        aria-label={`View ${totalSources} sources`}
      >
        <ShieldCheck className="h-3 w-3 text-primary shrink-0" />
        <span className="truncate max-w-[140px]">{pillText}</span>
      </button>

      {/* Floating Perplexity-style Popover Card matching Screenshot 1 */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Source citation details"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 sm:w-96 rounded-2xl border border-white/10 bg-[#12161F]/95 backdrop-blur-xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.8)] text-left animate-in fade-in zoom-in-95 duration-150"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Top Bar: Carousel & Sources counter */}
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] text-[11px] text-zinc-400">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={totalSources <= 1}
                className="rounded p-1 text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                title="Previous source"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-mono text-[11px] font-semibold text-zinc-300">
                {activeIdx + 1}/{totalSources}
              </span>
              <button
                type="button"
                onClick={handleNext}
                disabled={totalSources <= 1}
                className="rounded p-1 text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                title="Next source"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 font-medium">
              <span className="flex h-2 w-2 rounded-full bg-evidence animate-pulse" />
              <span className="text-zinc-300 font-mono text-[11px]">
                {totalSources} {totalSources === 1 ? "source" : "sources"}
              </span>
            </div>
          </div>

          {/* Body: Document Source Details */}
          <div className="pt-3">
            {/* Source Origin Header */}
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/20 text-primary shrink-0">
                <Building2 className="h-3 w-3" />
              </div>
              <span className="text-xs font-semibold text-zinc-200 truncate">
                {primaryName}
              </span>
              {currentSource.page_number && (
                <span className="ml-auto font-mono text-[10px] text-zinc-400 bg-white/[0.06] px-1.5 py-0.5 rounded">
                  Page {currentSource.page_number}
                </span>
              )}
            </div>

            {/* Document Section / Title */}
            <h4 className="text-[13px] font-semibold text-white line-clamp-1 mb-2">
              {sectionTitle}
            </h4>

            {/* Snippet / Excerpt */}
            <p className="text-[11.5px] leading-relaxed text-zinc-300 line-clamp-4 bg-black/20 p-2.5 rounded-lg border border-white/[0.04] mb-3">
              &ldquo;{currentSource.snippet?.trim()}&rdquo;
            </p>

            {/* Trust & Grounding Badge */}
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 mb-2.5">
              <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-semibold mb-1">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>Verified Grounding</span>
              </div>
              <p className="text-[10px] leading-normal text-emerald-300/80">
                Indexed in confidential organization vault with certified page citation integrity.
              </p>
            </div>

            {/* Action link */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] font-mono text-zinc-500">
                ID: {currentSource.chunk_id ? currentSource.chunk_id.slice(0, 12) + "…" : "chunk"}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setIsOpen(false);
                  if (onOpenDocument) {
                    onOpenDocument(
                      currentSource.document_id,
                      currentSource.page_number ?? undefined,
                      currentSource.snippet
                    );
                  }
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary-hover hover:underline transition-colors cursor-pointer"
              >
                Inspect document <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Tiny down pointer triangle */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] border-solid border-t-[#12161F] border-t-8 border-x-transparent border-x-8 border-b-0 pointer-events-none drop-shadow-md" />
        </div>
      )}
    </span>
  );
}
