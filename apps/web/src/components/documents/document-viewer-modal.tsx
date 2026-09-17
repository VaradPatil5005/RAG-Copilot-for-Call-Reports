"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import {
  X,
  FileText,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Search,
  BookOpen,
  Eye,
  Info,
  Building2,
  Calendar,
  User,
  Shield,
  Loader2,
  Table as TableIcon,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDocument,
  getElements,
  getDocumentPdfBlob,
  figureUrl,
  type DocumentDetail,
  type ElementItem,
} from "@/lib/api";
import { StatusBadge } from "./status-badge";

interface DocumentViewerModalProps {
  documentId: string | null;
  initialPage?: number | null;
  highlightSnippet?: string | null;
  onClose: () => void;
}

type ViewMode = "reader" | "pdf" | "info";

export function DocumentViewerModal({
  documentId,
  initialPage,
  highlightSnippet,
  onClose,
}: DocumentViewerModalProps) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [elements, setElements] = useState<ElementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("reader");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(initialPage || 1);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFullScreen, setIsFullScreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const highlightedRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Load document metadata and elements
  useEffect(() => {
    if (!documentId) return;
    let isMounted = true;
    setLoading(true);
    setError(null);

    Promise.all([
      getDocument(documentId).catch((err) => {
        console.error("Error fetching document:", err);
        return null;
      }),
      getElements(documentId).catch((err) => {
        console.error("Error fetching elements:", err);
        return [] as ElementItem[];
      }),
    ])
      .then(([docData, elementsData]) => {
        if (!isMounted) return;
        if (!docData) {
          setError("Document not found or inaccessible.");
        } else {
          setDoc(docData);
          setElements(elementsData);
          if (initialPage) {
            setCurrentPage(initialPage);
          }
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [documentId, initialPage]);

  // Lazy-load PDF Blob when switching to PDF tab or clicking download
  useEffect(() => {
    if (!documentId) return;
    if (viewMode === "pdf" && !pdfBlobUrl && !pdfLoading) {
      setPdfLoading(true);
      getDocumentPdfBlob(documentId)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          setPdfBlobUrl(url);
        })
        .catch((err) => {
          console.error("Failed to load PDF blob:", err);
        })
        .finally(() => {
          setPdfLoading(false);
        });
    }
  }, [documentId, viewMode, pdfBlobUrl, pdfLoading]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [pdfBlobUrl]);

  // Scroll to highlighted citation snippet when reader loads
  useEffect(() => {
    if (!loading && highlightedRef.current && viewMode === "reader") {
      setTimeout(() => {
        highlightedRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 250);
    }
  }, [loading, viewMode]);

  // Group elements by page
  const pagesMap = useMemo(() => {
    const map = new Map<number, ElementItem[]>();
    for (const el of elements) {
      const page = el.page_number || 1;
      if (!map.has(page)) {
        map.set(page, []);
      }
      map.get(page)!.push(el);
    }
    return map;
  }, [elements]);

  const sortedPageNumbers = useMemo(() => {
    const keys = Array.from(pagesMap.keys()).sort((a, b) => a - b);
    return keys.length > 0 ? keys : [1];
  }, [pagesMap]);

  const totalPages = doc?.latest?.page_count || sortedPageNumbers[sortedPageNumbers.length - 1] || 1;

  // Handle Download PDF
  const handleDownload = async () => {
    if (!documentId) return;
    try {
      let url = pdfBlobUrl;
      if (!url) {
        const blob = await getDocumentPdfBlob(documentId);
        url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = doc?.filename || `${documentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  // Handle Open in New Tab
  const handleOpenNewTab = async () => {
    if (!documentId) return;
    try {
      let url = pdfBlobUrl;
      if (!url) {
        const blob = await getDocumentPdfBlob(documentId);
        url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);
      }
      window.open(url, "_blank");
    } catch (err) {
      console.error("Opening in new tab failed:", err);
    }
  };

  if (!documentId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Full Document Viewer - ${doc?.filename || documentId}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 md:p-6 animate-in fade-in duration-150"
    >
      <div
        ref={containerRef}
        className={cn(
          "relative flex flex-col w-full bg-[#0E131F] border border-white/10 rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.9)] overflow-hidden transition-all duration-200",
          isFullScreen ? "h-full max-w-none" : "h-[94vh] max-w-6xl"
        )}
      >
        {/* ================= TOP HEADER BAR ================= */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-[#121826] px-5 py-3.5 shrink-0">
          {/* Document Identity */}
          <div className="flex items-center gap-3 min-w-0 max-w-[45%]">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0 border border-primary/20">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate" title={doc?.filename || documentId}>
                {doc?.filename || documentId}
              </h2>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <span className="font-mono text-zinc-300">{documentId}</span>
                {doc?.customer_name && (
                  <>
                    <span>•</span>
                    <span className="truncate text-zinc-300 flex items-center gap-1">
                      <Building2 className="h-3 w-3 text-primary/70 inline" />
                      {doc.customer_name}
                    </span>
                  </>
                )}
                {doc?.latest?.version && (
                  <>
                    <span>•</span>
                    <span className="text-zinc-400">v{doc.latest.version}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Center: View Mode Tabs */}
          <div className="flex items-center gap-1 rounded-xl bg-black/40 p-1 border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setViewMode("reader")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                viewMode === "reader"
                  ? "bg-white/10 text-white shadow-sm border border-white/10 font-semibold"
                  : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
              )}
            >
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              <span>Full Document</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("pdf")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                viewMode === "pdf"
                  ? "bg-white/10 text-white shadow-sm border border-white/10 font-semibold"
                  : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
              )}
            >
              <Eye className="h-3.5 w-3.5 text-emerald-400" />
              <span>Raw PDF</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("info")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                viewMode === "info"
                  ? "bg-white/10 text-white shadow-sm border border-white/10 font-semibold"
                  : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
              )}
            >
              <Info className="h-3.5 w-3.5 text-sky-400" />
              <span>Details</span>
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Page Navigator */}
            {viewMode === "reader" && totalPages > 1 && (
              <div className="hidden sm:flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2 py-1 text-xs text-zinc-300">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="rounded p-0.5 text-zinc-400 hover:text-white disabled:opacity-30"
                  title="Previous Page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="font-mono text-[11px]">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded p-0.5 text-zinc-400 hover:text-white disabled:opacity-30"
                  title="Next Page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Download PDF */}
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs font-medium text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors"
              title="Download original PDF"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Download</span>
            </button>

            {/* Open in New Tab */}
            <button
              type="button"
              onClick={handleOpenNewTab}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
              title="Open raw PDF in new browser tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>

            {/* Toggle Fullscreen */}
            <button
              type="button"
              onClick={() => setIsFullScreen((prev) => !prev)}
              className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
              title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center h-8 w-8 rounded-lg bg-white/[0.06] text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors ml-1"
              title="Close viewer (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ================= BODY CONTENT ================= */}
        <div className="flex-1 overflow-y-auto relative bg-[#090C14]">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Opening full document…</p>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-6 max-w-md">
                <p className="text-sm font-semibold text-rose-300">{error}</p>
                <p className="mt-2 text-xs text-rose-200/70">
                  The requested document could not be retrieved. Ensure the API is running and access permissions match.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-4 px-4 py-1.5 rounded-lg bg-white/10 text-xs font-medium text-white hover:bg-white/20 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : viewMode === "reader" ? (
            /* ================= FULL STRUCTURED DOCUMENT READER ================= */
            <div className="p-4 sm:p-8 md:p-12 max-w-5xl mx-auto space-y-10">
              {/* Document Banner / Cover Info */}
              <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent p-6 sm:p-8 shadow-inner">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                    <Shield className="h-4 w-4" />
                    <span>Verified Organization Call Report</span>
                  </div>
                  {doc?.classification && (
                    <span className="rounded-full bg-primary/15 border border-primary/30 px-3 py-1 text-[11px] font-semibold text-primary uppercase tracking-wide">
                      {doc.classification}
                    </span>
                  )}
                </div>

                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-3">
                  {doc?.filename}
                </h1>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-white/[0.06] text-xs">
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase font-medium">Customer</span>
                    <span className="font-medium text-zinc-200 flex items-center gap-1.5 mt-0.5">
                      <Building2 className="h-3.5 w-3.5 text-zinc-400" />
                      {doc?.customer_name || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase font-medium">Account Owner</span>
                    <span className="font-medium text-zinc-200 flex items-center gap-1.5 mt-0.5">
                      <User className="h-3.5 w-3.5 text-zinc-400" />
                      {doc?.account_owner || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase font-medium">Meeting Date</span>
                    <span className="font-medium text-zinc-200 flex items-center gap-1.5 mt-0.5">
                      <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                      {doc?.meeting_date || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase font-medium">Document ID</span>
                    <span className="font-mono text-zinc-300 mt-0.5 block">{doc?.document_id}</span>
                  </div>
                </div>

                {/* Real-time search in document */}
                <div className="mt-5 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search inside this document…"
                    className="w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-4 py-2 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-primary/50 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Render Each Page */}
              {sortedPageNumbers.map((pageNum) => {
                const pageElements = pagesMap.get(pageNum) || [];

                return (
                  <div
                    key={`page-${pageNum}`}
                    id={`page-${pageNum}`}
                    className="rounded-2xl border border-white/[0.08] bg-[#111624] p-6 sm:p-10 shadow-2xl relative"
                  >
                    {/* Page Header Ribbon */}
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-6 text-xs text-zinc-400">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span>PAGE {pageNum}</span>
                      </div>
                      <span className="text-[11px] text-zinc-500">
                        {pageElements.length} elements extracted
                      </span>
                    </div>

                    {/* Page Content Elements */}
                    <div className="space-y-4">
                      {pageElements.map((el) => {
                        // Check if this element matches the grounded citation snippet
                        const isSnippetMatch =
                          highlightSnippet &&
                          el.text &&
                          (el.text.includes(highlightSnippet.slice(0, 40)) ||
                            highlightSnippet.includes(el.text.slice(0, 40)));

                        // Search highlighting
                        const matchesSearch =
                          searchQuery &&
                          el.text &&
                          el.text.toLowerCase().includes(searchQuery.toLowerCase());

                        return (
                          <div
                            key={el.element_id}
                            ref={isSnippetMatch ? highlightedRef : undefined}
                            className={cn(
                              "transition-all duration-200 rounded-xl p-2",
                              isSnippetMatch &&
                                "bg-amber-500/10 border-2 border-amber-400/50 shadow-[0_0_30px_rgba(245,158,11,0.15)] ring-1 ring-amber-400/30 p-4 my-3",
                              matchesSearch && "bg-primary/10 border border-primary/30 p-3"
                            )}
                          >
                            {/* Citation Grounding Marker Banner */}
                            {isSnippetMatch && (
                              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 mb-2 pb-1.5 border-b border-amber-500/20">
                                <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                                <span>Grounded Source Citation Match (from Copilot answer)</span>
                              </div>
                            )}

                            {/* Headings */}
                            {el.element_type === "heading" && (
                              <div
                                className={cn(
                                  "font-bold text-white tracking-tight",
                                  el.heading_level === 1 && "text-xl sm:text-2xl mt-4 mb-2 text-primary",
                                  el.heading_level === 2 && "text-lg sm:text-xl mt-3 mb-1 text-zinc-100",
                                  (el.heading_level || 3) >= 3 && "text-base font-semibold text-zinc-200 mt-2"
                                )}
                              >
                                {el.text}
                              </div>
                            )}

                            {/* Paragraphs */}
                            {el.element_type === "paragraph" && (
                              <p className="text-[13px] sm:text-[14px] leading-relaxed text-zinc-300 whitespace-pre-line">
                                {el.text}
                              </p>
                            )}

                            {/* Tables */}
                            {el.element_type === "table" && (
                              <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                                <div className="flex items-center gap-2 border-b border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs font-medium text-zinc-300">
                                  <TableIcon className="h-3.5 w-3.5 text-primary" />
                                  <span>Structured Financial Table</span>
                                </div>

                                {el.table_json?.headers ? (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                      <thead className="border-b border-white/[0.08] bg-white/[0.02] text-zinc-400 uppercase tracking-wider text-[10px]">
                                        <tr>
                                          {el.table_json.headers.map((h: string, idx: number) => (
                                            <th key={idx} className="px-4 py-2.5 font-semibold text-zinc-200">
                                              {h}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-white/[0.04]">
                                        {el.table_json.rows?.map((row: string[], rIdx: number) => (
                                          <tr key={rIdx} className="hover:bg-white/[0.02] transition-colors">
                                            {row.map((cell: string, cIdx: number) => (
                                              <td key={cIdx} className="px-4 py-2.5 text-zinc-300">
                                                {cell}
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <pre className="p-4 text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre">
                                    {el.text || el.markdown}
                                  </pre>
                                )}
                              </div>
                            )}

                            {/* Figures & Images */}
                            {el.element_type === "figure" && el.figure_path && (
                              <div className="my-4 rounded-xl border border-white/10 bg-black/40 p-4 text-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={figureUrl(doc!.document_id, el.figure_path)}
                                  alt={el.description || "Document Figure"}
                                  className="max-h-96 mx-auto rounded-lg object-contain shadow-lg"
                                />
                                {el.description && (
                                  <p className="mt-2 text-xs text-zinc-400 italic">
                                    {el.description}
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Fallback for other element types */}
                            {!["heading", "paragraph", "table", "figure"].includes(el.element_type) && (
                              <div className="text-xs text-zinc-300 leading-relaxed">
                                {el.text}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Page Footer */}
                    <div className="mt-8 pt-4 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                      <span>{doc?.filename}</span>
                      <span>Page {pageNum}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : viewMode === "pdf" ? (
            /* ================= AUTHENTIC RAW PDF VIEWER ================= */
            <div className="h-full w-full flex flex-col bg-zinc-900 relative">
              {pdfLoading ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
                  <p className="text-sm font-medium">Loading authentic PDF stream…</p>
                </div>
              ) : pdfBlobUrl ? (
                <iframe
                  src={`${pdfBlobUrl}#page=${currentPage}&toolbar=1&navpanes=1`}
                  title={doc?.filename || "PDF Document"}
                  className="w-full h-full border-0"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-zinc-400">
                  <p className="text-sm">Unable to render PDF stream directly.</p>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-black font-medium text-xs hover:bg-emerald-400 transition-colors"
                  >
                    <Download className="h-4 w-4" /> Download PDF to view
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ================= METADATA & AUDIT DETAILS ================= */
            <div className="p-6 sm:p-10 max-w-4xl mx-auto space-y-6">
              <div className="rounded-2xl border border-white/[0.08] bg-[#111624] p-6 space-y-6">
                <div>
                  <h3 className="text-base font-semibold text-white">Technical Metadata & Audit Profile</h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    System specifications, extraction hashes, and pipeline audit events.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Document ID</span>
                    <span className="font-mono text-zinc-200 text-sm mt-1 block">{doc?.document_id}</span>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Processing Status</span>
                    <div className="mt-1">
                      {doc?.latest && <StatusBadge status={doc.latest.status} />}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">SHA-256 Checksum</span>
                    <span className="font-mono text-zinc-400 text-[11px] mt-1 block truncate" title={doc?.latest?.sha256}>
                      {doc?.latest?.sha256 || "—"}
                    </span>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Parser Engine</span>
                    <span className="text-zinc-200 mt-1 block">
                      {doc?.latest?.parser || "Default"} v{doc?.latest?.parser_version || "1.0"}
                    </span>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Total Pages</span>
                    <span className="text-zinc-200 text-sm font-semibold mt-1 block">{totalPages}</span>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                    <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Extracted Elements</span>
                    <span className="text-zinc-200 text-sm font-semibold mt-1 block">{elements.length} elements</span>
                  </div>
                </div>

                {/* Audit Timeline */}
                {doc?.events && doc.events.length > 0 && (
                  <div className="pt-4 border-t border-white/[0.06]">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                      Pipeline Ingestion Audit Log
                    </h4>
                    <div className="space-y-2">
                      {doc.events.map((ev, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-black/30 border border-white/[0.04]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-zinc-300">{ev.stage}</span>
                            <span className="text-zinc-500">→</span>
                            <span className="text-primary">{ev.status}</span>
                            {ev.message && <span className="text-zinc-400 text-[11px]">({ev.message})</span>}
                          </div>
                          <span className="text-[10px] font-mono text-zinc-500">
                            {new Date(ev.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
