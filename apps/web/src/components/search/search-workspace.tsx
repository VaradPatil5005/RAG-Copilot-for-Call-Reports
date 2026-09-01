"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Search as SearchIcon,
  Loader2,
  AlertTriangle,
  FileSearch,
  SlidersHorizontal,
  FileText,
  Table2,
  Image as ImageIcon,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { search, type SearchResultItem, type RetrievalTrace } from "@/lib/api";

const CHUNK_ICON: Record<SearchResultItem["chunk_type"], typeof FileText> = {
  passage: FileText,
  table: Table2,
  figure: ImageIcon,
};

export function SearchWorkspace() {
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [trace, setTrace] = useState<RetrievalTrace | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setStatus("loading");
    setError(null);
    try {
      const res = await search(q, {
        topK: 12,
        filters: {
          customer: customer.trim() || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        },
      });
      setResults(res.results);
      setTrace(res.trace);
      setLastQuery(q);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setStatus("error");
    }
  }, [query, customer, dateFrom, dateTo]);

  return (
    <div className="px-8">
      <div className="rounded-xl border border-border-subtle bg-surface/60 p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint"
              strokeWidth={1.75}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Ask about a customer, risk, commitment, or metric — e.g. “What risks were raised for Contoso?”"
              className="w-full rounded-lg border border-border-subtle bg-elevated/60 py-2.5 pl-9 pr-3 text-[13px] text-text placeholder:text-text-faint focus:border-primary-dim outline-none"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2.5 text-[12px] font-medium transition-colors",
              showFilters
                ? "border-primary-dim/60 bg-primary-dim/20 text-primary"
                : "border-border-subtle bg-elevated/60 text-text-muted hover:text-text"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
            Filters
          </button>
          <button
            onClick={runSearch}
            disabled={!query.trim() || status === "loading"}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[12px] font-medium text-bg transition-opacity disabled:opacity-40"
          >
            {status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Search
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border-subtle pt-3 sm:grid-cols-3">
            <Field label="Customer">
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="e.g. Contoso"
                className={inputCls}
              />
            </Field>
            <Field label="Meeting date from">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Meeting date to">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
        )}
      </div>

      {status === "error" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[12px] text-error">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error || "Search failed. Make sure the backend is running at apps/api."}
        </div>
      )}

      {status === "loading" && (
        <div className="mt-8 flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-text-faint" strokeWidth={1.5} />
          <p className="text-[12px] text-text-faint">
            Running hybrid search — BM25 + vector, RRF fusion, reranking…
          </p>
        </div>
      )}

      {status === "idle" && (
        <div className="mt-10 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle py-14 text-center">
          <FileSearch className="h-6 w-6 text-text-faint" strokeWidth={1.5} />
          <p className="text-[13px] text-text-muted">Search across every ingested call report</p>
          <p className="max-w-sm text-[12px] text-text-faint">
            Hybrid BM25 + vector search with Reciprocal Rank Fusion and reranking — results include
            narrative passages and table evidence, cited to a document and page.
          </p>
        </div>
      )}

      {status === "done" && results.length === 0 && (
        <div className="mt-10 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle py-14 text-center">
          <FileSearch className="h-6 w-6 text-text-faint" strokeWidth={1.5} />
          <p className="text-[13px] text-text-muted">No results for “{lastQuery}”</p>
          <p className="max-w-sm text-[12px] text-text-faint">
            Try removing filters, or a broader phrasing — hybrid search still requires at least a
            partial keyword or semantic match.
          </p>
        </div>
      )}

      {status === "done" && results.length > 0 && (
        <>
          {trace && <TraceBar trace={trace} />}
          <div className="mt-3 space-y-2.5">
            {results.map((r) => (
              <ResultCard key={r.chunk_id} result={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TraceBar({ trace }: { trace: RetrievalTrace }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border-subtle bg-elevated/40 px-3.5 py-2 text-[11px] text-text-faint">
      <span>
        <span className="text-text-muted">{trace.bm25_candidates}</span> BM25
      </span>
      <span>
        <span className="text-text-muted">{trace.vector_candidates}</span> vector
      </span>
      <ChevronRight className="h-3 w-3" />
      <span>
        <span className="text-text-muted">{trace.fused_candidates}</span> RRF-fused
      </span>
      <ChevronRight className="h-3 w-3" />
      <span>
        <span className="text-text-muted">{trace.reranked_candidates}</span> reranked
      </span>
      <ChevronRight className="h-3 w-3" />
      <span>
        <span className="text-text-muted">{trace.diversified_candidates}</span> diversified →{" "}
        <span className="text-text-muted">{trace.final_count}</span> shown
      </span>
      {trace.embedding_provider === "hashing-fallback" && (
        <span className="ml-auto flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
          <AlertTriangle className="h-3 w-3" />
          embedding fallback active — see ADR 0004
        </span>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: SearchResultItem }) {
  const Icon = CHUNK_ICON[result.chunk_type];
  return (
    <div className="rounded-xl border border-border-subtle bg-surface/60 p-4 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
          <Link
            href={`/documents?doc=${encodeURIComponent(result.document_id)}`}
            className="truncate text-[12px] font-medium text-text hover:text-primary"
          >
            {result.customer_name || result.document_id}
          </Link>
          <span className="shrink-0 font-mono text-[10px] text-text-faint">
            {result.document_id} · p.{result.page_number ?? "—"}
          </span>
        </div>
        <span className="shrink-0 rounded-full border border-border-subtle bg-elevated px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-faint">
          {result.chunk_type}
        </span>
      </div>

      {result.section_path.length > 0 && (
        <p className="mt-1.5 truncate text-[11px] text-text-faint">
          {result.section_path.join(" › ")}
        </p>
      )}

      {result.chunk_type === "table" && result.table_json ? (
        <div className="mt-2.5 overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="bg-elevated/60">
                {result.table_json.headers.map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-2.5 py-1.5 font-medium text-text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.table_json.rows.slice(0, 6).map((row, i) => (
                <tr key={i} className="border-t border-border-subtle">
                  {row.map((cell, j) => (
                    <td key={j} className="whitespace-nowrap px-2.5 py-1.5 text-text-muted">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-text-muted">{result.snippet}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2.5">
        <ScorePill label="BM25" value={result.bm25_score} />
        <ScorePill label="vector" value={result.vector_score} />
        <ScorePill label="RRF" value={result.rrf_score} decimals={4} />
        <ScorePill label="rerank" value={result.rerank_score} highlight />
      </div>
    </div>
  );
}

function ScorePill({
  label,
  value,
  decimals = 2,
  highlight,
}: {
  label: string;
  value: number | null;
  decimals?: number;
  highlight?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[10px]",
        highlight
          ? "border-evidence-dim/60 bg-evidence-dim/20 text-evidence"
          : "border-border-subtle bg-elevated/60 text-text-faint"
      )}
    >
      {label} {value === null || value === undefined ? "—" : value.toFixed(decimals)}
    </span>
  );
}

const inputCls =
  "w-full rounded-md border border-border-subtle bg-elevated/60 px-2.5 py-1.5 text-[12px] text-text placeholder:text-text-faint focus:border-primary-dim outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-text-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
