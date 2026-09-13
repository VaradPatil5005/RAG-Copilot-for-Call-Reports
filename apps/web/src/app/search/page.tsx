"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Search as SearchIcon,
  Loader2,
  SlidersHorizontal,
  FileText,
  Table2,
  ImageIcon,
  ChevronRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { search, type SearchResultItem, type RetrievalTrace } from "@/lib/api";

const CHUNK_ICON: Record<string, typeof FileText> = {
  passage: FileText,
  table: Table2,
  figure: ImageIcon,
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [trace, setTrace] = useState<RetrievalTrace | null>(null);
  const [ranQuery, setRanQuery] = useState("");

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const res = await search(q, {
          topK: 12,
          filters: {
            customer: customer || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
          },
        });
        setResults(res.results);
        setTrace(res.trace);
        setRanQuery(q);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setResults(null);
        setTrace(null);
      } finally {
        setLoading(false);
      }
    },
    [customer, dateFrom, dateTo]
  );

  const activeFilterCount = [customer, dateFrom, dateTo].filter(Boolean).length;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Enterprise search"
        title="Search"
        description="Hybrid keyword + semantic search across customers, documents, tables, and entities."
      />

      <div className="mx-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
          className="flex items-center gap-3"
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. What risks were raised for Contoso?"
              aria-label="Search query"
              data-testid="search-input"
              className="w-full rounded-xl border border-white/10 bg-surface/80 backdrop-blur-xl py-3 pl-10 pr-4 text-[13px] text-text placeholder:text-text-faint outline-none focus:border-evidence/50 focus:shadow-[0_0_20px_rgba(79,209,197,0.15)] transition-all"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-3 text-[12px] font-medium transition-all duration-200",
              showFilters || activeFilterCount > 0
                ? "border-primary/50 bg-primary/15 text-primary shadow-[0_0_12px_rgba(240,168,87,0.2)]"
                : "border-white/10 bg-surface/70 text-text-muted hover:bg-elevated hover:text-text"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary/25 px-1.5 font-mono text-[10px] font-bold">{activeFilterCount}</span>
            )}
          </button>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-amber-500 hover:brightness-110 px-5 py-3 text-[12px] font-bold text-bg shadow-[0_0_15px_rgba(240,168,87,0.25)] transition-all disabled:opacity-40"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {showFilters && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle bg-surface/60 p-3">
            <FilterField label="Customer">
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="e.g. Contoso"
                className={filterInputCls}
              />
            </FilterField>
            <FilterField label="Date from">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={filterInputCls}
              />
            </FilterField>
            <FilterField label="Date to">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={filterInputCls}
              />
            </FilterField>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setCustomer("");
                  setDateFrom("");
                  setDateTo("");
                }}
                className="flex items-center gap-1 text-[11px] text-text-faint hover:text-text-muted"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mx-8 mt-6">
        {error && (
          <div className="rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[12px] text-error">
            Can&apos;t reach the search API: {error}. Make sure the backend is running at{" "}
            <code className="font-mono">apps/api</code>.
          </div>
        )}

        {!error && loading && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle py-16 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
            <p className="text-[12px] text-text-faint">
              Running BM25 + vector search, fusing with RRF, and reranking…
            </p>
          </div>
        )}

        {!error && !loading && results === null && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle py-16 text-center">
            <SearchIcon className="h-6 w-6 text-text-faint" strokeWidth={1.5} />
            <p className="text-[13px] text-text-muted">Search across every indexed call report</p>
            <p className="max-w-sm text-[12px] text-text-faint">
              Try a customer name, a risk or pricing question, or something you know is buried in a
              table — e.g. &quot;pipeline value for Contoso in Q2&quot;.
            </p>
          </div>
        )}

        {!error && !loading && results !== null && results.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle py-16 text-center">
            <SearchIcon className="h-6 w-6 text-text-faint" strokeWidth={1.5} />
            <p className="text-[13px] text-text-muted">No results for &quot;{ranQuery}&quot;</p>
            <p className="max-w-sm text-[12px] text-text-faint">
              Try removing filters, or check that documents have finished indexing in Documents.
            </p>
          </div>
        )}

        {!error && !loading && results !== null && results.length > 0 && (
          <div>
            {trace && (
              <p className="mb-3 text-[11px] text-text-faint">
                {trace.bm25_candidates} lexical · {trace.vector_candidates} vector candidates → fused{" "}
                {trace.fused_candidates} → reranked → {trace.final_count} shown
                {trace.embedding_provider === "hashing-fallback" && (
                  <span className="ml-1 text-warning">(embedding fallback active in this environment)</span>
                )}
              </p>
            )}
            <div className="space-y-2.5">
              {results.map((r) => (
                <ResultCard key={r.chunk_id} result={r} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: SearchResultItem }) {
  const Icon = CHUNK_ICON[result.chunk_type] ?? FileText;
  const relevance = result.rerank_score ?? result.rrf_score ?? 0;

  return (
    <Link
      href={`/documents?doc=${encodeURIComponent(result.document_id)}`}
      className="group block rounded-2xl border border-white/8 bg-surface/70 backdrop-blur-xl p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all duration-300 hover:border-evidence/40 hover:bg-surface/90 hover:shadow-[0_8px_30px_rgba(0,0,0,0.5),0_0_20px_rgba(79,209,197,0.08)] hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-evidence/10 border border-evidence/25 text-evidence shadow-[0_0_10px_rgba(79,209,197,0.2)]">
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-text group-hover:text-white transition-colors">
              {result.customer_name || result.document_id}
              {result.meeting_date && (
                <span className="ml-2 font-mono text-[11px] text-text-faint font-normal">· {result.meeting_date}</span>
              )}
            </p>
            <p className="truncate font-mono text-[11px] text-text-faint mt-0.5">
              {result.section_path.length > 0 ? result.section_path.join(" › ") : result.document_id}
              {result.page_number != null && ` · p.${result.page_number}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ScorePill label="relevance" value={relevance} />
          <ChevronRight className="h-4 w-4 text-text-faint transition-transform group-hover:translate-x-1 group-hover:text-evidence" />
        </div>
      </div>

      {result.chunk_type === "table" && result.table_json ? (
        <div className="mt-2.5 overflow-x-auto rounded border border-border-subtle">
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                {result.table_json.headers.map((h, i) => (
                  <th key={i} className="border-b border-border-subtle px-1.5 py-1 text-left text-text-faint">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.table_json.rows.slice(0, 4).map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} className="px-1.5 py-1 text-text-muted">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-text-muted">{result.snippet}</p>
      )}

      <div className="mt-2.5 flex items-center gap-3 text-[10px] text-text-faint">
        {result.bm25_score != null && <span>BM25 {result.bm25_score.toFixed(2)}</span>}
        {result.vector_score != null && <span>Vector {result.vector_score.toFixed(3)}</span>}
        {result.rrf_score != null && <span>RRF {result.rrf_score.toFixed(4)}</span>}
        {result.is_expansion && <span className="text-primary">Expanded context</span>}
      </div>
    </Link>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value / 3)) * 100; // rerank scores aren't 0-1 normalized; rough visual only
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${value.toFixed(3)}`}>
      <div className="h-1 w-10 overflow-hidden rounded-full bg-elevated-2">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-text-faint">{value.toFixed(2)}</span>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-text-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

const filterInputCls =
  "rounded-md border border-border-subtle bg-elevated/60 px-2.5 py-1.5 text-[12px] text-text placeholder:text-text-faint focus:border-primary-dim outline-none";
