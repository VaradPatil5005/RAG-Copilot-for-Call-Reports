"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { listDocuments, type DocumentSummary } from "@/lib/api";
import { UploadPanel } from "./upload-panel";
import { DocumentsTable } from "./documents-table";
import { DocumentDetailPanel } from "./document-detail";
import { isActiveStatus } from "./status-badge";

export function DocumentsWorkspace() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualSelectedId, setManualSelectedId] = useState<string | null>(null);
  const [deepLinkClosed, setDeepLinkClosed] = useState(false);
  const [apiError, setApiError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchParams = useSearchParams();

  // Deep-link support: ?doc=<document_id> (e.g. from a Search result) opens
  // that document's detail panel. Derived directly from the URL (no effect
  // needed) with a manual selection/close taking precedence once the user
  // interacts, so closing the panel doesn't immediately reopen it.
  const deepLinkDoc = searchParams.get("doc");
  const selectedId = manualSelectedId ?? (deepLinkClosed ? null : deepLinkDoc);

  const selectDocument = useCallback((id: string | null) => {
    setManualSelectedId(id);
    setDeepLinkClosed(id === null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setApiError(false);
    } catch {
      setApiError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Async fetch-on-mount: setState happens after the awaited network call,
    // not synchronously within the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    return () => clearTimeout(timerRef.current);
  }, [refresh]);

  // Poll while anything is actively processing; otherwise idle.
  useEffect(() => {
    const anyActive = documents.some((d) => d.latest && isActiveStatus(d.latest.status));
    const interval = anyActive ? 1500 : 6000;
    timerRef.current = setTimeout(refresh, interval);
    return () => clearTimeout(timerRef.current);
  }, [documents, refresh]);

  return (
    <div className="pb-12">
      {apiError && (
        <div className="mx-8 mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-2.5 text-[12px] text-error">
          Can&apos;t reach the ingestion API. Make sure the backend is running at{" "}
          <code className="font-mono">apps/api</code> (
          <code className="font-mono">uvicorn app.main:app --reload</code>).
        </div>
      )}
      <UploadPanel onUploaded={refresh} />
      <DocumentsTable
        documents={documents}
        onSelect={selectDocument}
        selectedId={selectedId}
        loading={loading}
      />
      {selectedId && (
        <DocumentDetailPanel
          documentId={selectedId}
          onClose={() => selectDocument(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
