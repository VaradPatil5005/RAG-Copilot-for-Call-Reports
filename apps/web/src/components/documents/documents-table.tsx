"use client";

import { useMemo, useState } from "react";
import { Search, FileText, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentSummary } from "@/lib/api";
import { StatusBadge } from "./status-badge";

interface DocumentsTableProps {
  documents: DocumentSummary[];
  onSelect: (documentId: string) => void;
  selectedId: string | null;
  loading: boolean;
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "validating", label: "Validating" },
  { value: "extracting", label: "Extracting" },
  { value: "normalizing", label: "Normalizing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "quarantined", label: "Quarantined" },
  { value: "duplicate", label: "Duplicate" },
];

function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function DocumentsTable({ documents, onSelect, selectedId, loading }: DocumentsTableProps) {
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return documents.filter((d) => {
      if (status && d.latest?.status !== status) return false;
      if (customer && !(d.customer_name || "").toLowerCase().includes(customer.toLowerCase())) return false;
      if (owner && !(d.account_owner || "").toLowerCase().includes(owner.toLowerCase())) return false;
      if (
        q &&
        !(d.filename + d.document_id + (d.customer_name || "")).toLowerCase().includes(q.toLowerCase())
      )
        return false;
      return true;
    });
  }, [documents, status, customer, owner, q]);

  return (
    <div className="mx-8 mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search filename, ID, customer…"
            className="w-56 rounded-md border border-border-subtle bg-elevated/60 py-1.5 pl-8 pr-2.5 text-[12px] text-text placeholder:text-text-faint outline-none focus:border-primary-dim"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-border-subtle bg-elevated/60 px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-primary-dim"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder="Filter by customer"
          className="w-40 rounded-md border border-border-subtle bg-elevated/60 px-2.5 py-1.5 text-[12px] text-text placeholder:text-text-faint outline-none focus:border-primary-dim"
        />
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Filter by owner"
          className="w-40 rounded-md border border-border-subtle bg-elevated/60 px-2.5 py-1.5 text-[12px] text-text placeholder:text-text-faint outline-none focus:border-primary-dim"
        />
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-faint">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {filtered.length} of {documents.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border-subtle">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-border-subtle bg-surface/80 text-[10px] uppercase tracking-wide text-text-faint">
              <th className="px-4 py-2.5 font-medium">Document</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Pages</th>
              <th className="px-4 py-2.5 font-medium">Tables</th>
              <th className="px-4 py-2.5 font-medium">Figures</th>
              <th className="px-4 py-2.5 font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-text-faint">
                  {documents.length === 0
                    ? "No documents yet — upload a call report PDF above to get started."
                    : "No documents match these filters."}
                </td>
              </tr>
            )}
            {filtered.map((doc) => (
              <tr
                key={doc.document_id}
                onClick={() => onSelect(doc.document_id)}
                className={cn(
                  "cursor-pointer border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-elevated/50",
                  selectedId === doc.document_id && "bg-elevated/70"
                )}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{doc.filename}</p>
                      <p className="font-mono text-[10px] text-text-faint">{doc.document_id}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-text-muted">{doc.customer_name || "—"}</td>
                <td className="px-4 py-2.5 text-text-muted">{doc.account_owner || "—"}</td>
                <td className="px-4 py-2.5">
                  {doc.latest ? <StatusBadge status={doc.latest.status} /> : "—"}
                </td>
                <td className="px-4 py-2.5 text-text-muted">{doc.latest?.page_count ?? "—"}</td>
                <td className="px-4 py-2.5 text-text-muted">{doc.latest?.table_count ?? "—"}</td>
                <td className="px-4 py-2.5 text-text-muted">{doc.latest?.figure_count ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-text-faint">
                  {formatBytes(doc.latest?.size_bytes ?? null)}
                </td>
                <td className="px-4 py-2.5 text-text-faint">{formatDate(doc.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
