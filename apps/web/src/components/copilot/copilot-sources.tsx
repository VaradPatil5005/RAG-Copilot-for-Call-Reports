"use client";

/**
 * Copilot Sources Panel — Perplexity-style right-side source cards.
 *
 * Displays numbered source cards [1], [2], [3] for the currently
 * active answer. Hovering a source highlights the corresponding
 * inline citation badge in the answer, and vice versa.
 */

import Link from "next/link";
import { FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatCitation, ChatEvidenceItem } from "@/lib/api";
import { trackCitationClick } from "@/lib/api";

interface SourceCardProps {
  index: number;
  citation: ChatCitation;
  evidence?: ChatEvidenceItem;
  traceId?: string;
  isHighlighted: boolean;
  onHover: (index: number | null) => void;
}

function SourceCard({
  index,
  citation,
  evidence,
  traceId,
  isHighlighted,
  onHover,
}: SourceCardProps) {
  const handleClick = () => {
    if (traceId && citation.chunk_id) {
      trackCitationClick({
        trace_id: traceId,
        chunk_id: citation.chunk_id,
        document_id: citation.document_id,
        page_number: citation.page,
        interaction_type: "click",
      }).catch(() => {});
    }
  };

  const snippet = evidence?.snippet
    ? evidence.snippet.length > 120
      ? evidence.snippet.slice(0, 117) + "…"
      : evidence.snippet
    : null;

  const sectionPath = evidence?.section_path?.length
    ? evidence.section_path.join(" › ")
    : null;

  return (
    <Link
      href={`/documents?doc=${encodeURIComponent(citation.document_id)}&page=${citation.page ?? ""}`}
      onClick={handleClick}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      id={`source-card-${index}`}
      className={cn(
        "group block rounded-xl border p-3.5 transition-all duration-200",
        isHighlighted
          ? "border-evidence/50 bg-evidence/8 shadow-[0_0_20px_rgba(79,209,197,0.08)]"
          : "border-border-subtle bg-elevated/30 hover:border-border hover:bg-elevated/50"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Number badge */}
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition-colors",
            isHighlighted
              ? "bg-evidence/20 text-evidence"
              : "bg-elevated-2 text-text-faint group-hover:text-text-muted"
          )}
        >
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          {/* Document ID */}
          <div className="flex items-center gap-1.5">
            <FileText
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-colors",
                isHighlighted ? "text-evidence" : "text-text-faint"
              )}
              strokeWidth={1.75}
            />
            <span className="truncate text-[12px] font-medium text-text">
              {citation.document_id}
            </span>
            {citation.page != null && (
              <span className="shrink-0 text-[11px] text-text-faint">
                p.{citation.page}
              </span>
            )}
            <ExternalLink
              className="ml-auto h-3 w-3 shrink-0 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity"
              strokeWidth={1.75}
            />
          </div>

          {/* Section path */}
          {sectionPath && (
            <p className="mt-1 truncate text-[10px] text-text-faint">
              {sectionPath}
            </p>
          )}

          {/* Snippet preview */}
          {snippet && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-text-muted">
              {snippet}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

interface CopilotSourcesProps {
  citations: ChatCitation[];
  evidence: ChatEvidenceItem[];
  traceId?: string;
  highlightedIndex: number | null;
  onHoverSource: (index: number | null) => void;
}

export function CopilotSources({
  citations,
  evidence,
  traceId,
  highlightedIndex,
  onHoverSource,
}: CopilotSourcesProps) {
  if (citations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="rounded-xl border border-border-subtle bg-elevated/30 p-4">
          <FileText className="mx-auto h-8 w-8 text-text-faint" strokeWidth={1.25} />
          <p className="mt-3 text-[12px] font-medium text-text-muted">No sources yet</p>
          <p className="mt-1 text-[11px] text-text-faint">
            Sources will appear here when the Copilot answers a question.
          </p>
        </div>
      </div>
    );
  }

  // Match citations to evidence by chunk_id for snippet display
  const evidenceMap = new Map(evidence.map((e) => [e.chunk_id, e]));

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Sources
        </span>
        <span className="rounded-full bg-elevated-2 px-2 py-0.5 text-[10px] font-medium text-text-faint">
          {citations.length}
        </span>
      </div>

      <div className="space-y-2">
        {citations.map((c, i) => (
          <SourceCard
            key={`${c.document_id}-${c.page}-${i}`}
            index={i}
            citation={c}
            evidence={evidenceMap.get(c.chunk_id)}
            traceId={traceId}
            isHighlighted={highlightedIndex === i}
            onHover={onHoverSource}
          />
        ))}
      </div>
    </div>
  );
}
