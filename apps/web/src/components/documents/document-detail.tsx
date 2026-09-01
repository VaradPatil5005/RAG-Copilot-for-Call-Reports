"use client";

import { useEffect, useState } from "react";
import {
  X,
  Table2,
  Image as ImageIcon,
  Heading,
  FileText,
  RotateCw,
  Loader2,
  Pencil,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDocument,
  getElements,
  reprocessDocument,
  updateDocumentMetadata,
  figureUrl,
  type DocumentDetail,
  type ElementItem,
} from "@/lib/api";
import { StatusBadge, isActiveStatus } from "./status-badge";

interface Props {
  documentId: string;
  onClose: () => void;
  onChanged: () => void;
}

type Tab = "overview" | "timeline" | "structure";

export function DocumentDetailPanel({ documentId, onClose, onChanged }: Props) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [elementFilter, setElementFilter] = useState<string>("heading");
  const [elements, setElements] = useState<ElementItem[]>([]);
  const [reprocessing, setReprocessing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const d = await getDocument(documentId);
        if (cancelled) return;
        setDoc(d);
        if (d.latest && isActiveStatus(d.latest.status)) {
          timer = setTimeout(poll, 1200);
        }
      } catch {
        // document may not exist yet on first tick — retry briefly
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentId]);

  useEffect(() => {
    if (tab !== "structure" || !doc?.latest || doc.latest.status !== "completed") return;
    getElements(documentId, elementFilter || undefined).then(setElements).catch(() => setElements([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, elementFilter, documentId, doc?.latest?.status]);

  if (!doc) {
    return (
      <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md items-center justify-center border-l border-border-subtle bg-surface">
        <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
      </div>
    );
  }

  const latest = doc.latest;

  const handleReprocess = async () => {
    setReprocessing(true);
    try {
      await reprocessDocument(documentId, true);
      onChanged();
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border-subtle bg-surface shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-text">{doc.filename}</p>
          <p className="font-mono text-[10px] text-text-faint">
            {doc.document_id} · v{latest?.version ?? 1}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close document details" className="rounded p-1 text-text-faint hover:bg-elevated-2 hover:text-text">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between px-5 py-3">
        {latest && <StatusBadge status={latest.status} />}
        <button
          onClick={handleReprocess}
          disabled={reprocessing || (latest ? isActiveStatus(latest.status) : false)}
          className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[11px] text-text-muted hover:bg-elevated disabled:opacity-40"
        >
          <RotateCw className={cn("h-3 w-3", reprocessing && "animate-spin")} />
          Reprocess
        </button>
      </div>

      {latest?.error && (
        <div className="mx-5 mb-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-[11px] text-error">
          {latest.error}
        </div>
      )}

      <div className="flex border-b border-border-subtle px-5">
        {(["overview", "timeline", "structure"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            role="tab"
            aria-selected={tab === t}
            className={cn(
              "border-b-2 px-3 py-2 text-[11px] font-medium capitalize transition-colors",
              tab === t
                ? "border-primary text-text"
                : "border-transparent text-text-faint hover:text-text-muted"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {tab === "overview" && <OverviewTab doc={doc} onChanged={onChanged} />}
        {tab === "timeline" && <TimelineTab doc={doc} />}
        {tab === "structure" && (
          <StructureTab
            documentId={documentId}
            elements={elements}
            filter={elementFilter}
            setFilter={setElementFilter}
            ready={latest?.status === "completed"}
          />
        )}
      </div>
    </div>
  );
}

function OverviewTab({ doc, onChanged }: { doc: DocumentDetail; onChanged: () => void }) {
  const latest = doc.latest;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerName, setCustomerName] = useState(doc.customer_name || "");
  const [accountOwner, setAccountOwner] = useState(doc.account_owner || "");
  const [meetingDate, setMeetingDate] = useState(doc.meeting_date || "");
  const [classification, setClassification] = useState(doc.classification || "internal");

  const startEditing = () => {
    setCustomerName(doc.customer_name || "");
    setAccountOwner(doc.account_owner || "");
    setMeetingDate(doc.meeting_date || "");
    setClassification(doc.classification || "internal");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateDocumentMetadata(doc.document_id, {
        customer_name: customerName,
        account_owner: accountOwner,
        meeting_date: meetingDate,
        classification,
      });
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Pages" value={latest?.page_count ?? "—"} />
        <Stat label="Tables" value={latest?.table_count ?? 0} />
        <Stat label="Figures" value={latest?.figure_count ?? 0} />
        <Stat label="Headings" value={latest?.heading_count ?? 0} />
        <Stat label="OCR pages" value={latest?.ocr_pages ?? 0} />
        <Stat
          label="OCR confidence"
          value={latest?.ocr_confidence ? `${(latest.ocr_confidence * 100).toFixed(0)}%` : "—"}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wide text-text-faint">Metadata</p>
          {!editing ? (
            <button
              onClick={startEditing}
              className="flex items-center gap-1 text-[10px] text-text-faint hover:text-primary"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          ) : (
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1 text-[10px] text-primary hover:opacity-80 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <EditField label="Customer" value={customerName} onChange={setCustomerName} />
            <EditField label="Account owner" value={accountOwner} onChange={setAccountOwner} />
            <EditField label="Meeting date" value={meetingDate} onChange={setMeetingDate} type="date" />
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-text-faint">Classification</span>
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                className="w-full rounded-md border border-border-subtle bg-elevated/60 px-2 py-1 text-[12px] text-text outline-none focus:border-primary-dim"
              >
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
                <option value="public">Public</option>
              </select>
            </label>
          </div>
        ) : (
          <dl className="space-y-1 text-[12px]">
            <Row label="Customer" value={doc.customer_name || "—"} />
            <Row label="Account owner" value={doc.account_owner || "—"} />
            <Row label="Meeting date" value={doc.meeting_date || "—"} />
            <Row label="Classification" value={doc.classification || "—"} />
            <Row label="Tenant" value={doc.tenant_id} />
          </dl>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-faint">
          Processing manifest
        </p>
        <dl className="space-y-1 text-[12px]">
          <Row label="Checksum (SHA-256)" value={latest?.sha256.slice(0, 16) + "…" || "—"} mono />
          <Row label="Parser" value={latest?.parser || "—"} />
          <Row label="Parser version" value={latest?.parser_version || "—"} mono />
          <Row label="Size" value={latest?.size_bytes ? `${(latest.size_bytes / 1024).toFixed(0)} KB` : "—"} />
        </dl>
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-text-faint">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border-subtle bg-elevated/60 px-2 py-1 text-[12px] text-text outline-none focus:border-primary-dim"
      />
    </label>
  );
}

function TimelineTab({ doc }: { doc: DocumentDetail }) {
  return (
    <ol className="space-y-3">
      {doc.events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                e.status === "error" || e.status === "failed"
                  ? "bg-error"
                  : e.stage === "completed"
                  ? "bg-evidence"
                  : "bg-primary"
              )}
            />
            {i < doc.events.length - 1 && <span className="mt-0.5 w-px flex-1 bg-border-subtle" />}
          </div>
          <div className="pb-3">
            <p className="text-[12px] font-medium capitalize text-text">
              {e.stage.replace(/_/g, " ")} <span className="text-text-faint">· {e.status}</span>
            </p>
            {e.message && <p className="text-[11px] text-text-muted">{e.message}</p>}
            <p className="font-mono text-[10px] text-text-faint">
              {new Date(e.created_at).toLocaleTimeString()}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const ELEMENT_TABS: { value: string; label: string; icon: typeof Heading }[] = [
  { value: "heading", label: "Sections", icon: Heading },
  { value: "table", label: "Tables", icon: Table2 },
  { value: "figure", label: "Figures", icon: ImageIcon },
  { value: "paragraph", label: "Text", icon: FileText },
];

function StructureTab({
  documentId,
  elements,
  filter,
  setFilter,
  ready,
}: {
  documentId: string;
  elements: ElementItem[];
  filter: string;
  setFilter: (v: string) => void;
  ready: boolean;
}) {
  if (!ready) {
    return <p className="text-[12px] text-text-faint">Extracted structure will appear here once processing completes.</p>;
  }
  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {ELEMENT_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilter(t.value)}
            aria-pressed={filter === t.value}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px]",
              filter === t.value
                ? "border-primary-dim/60 bg-primary-dim/20 text-primary"
                : "border-border-subtle text-text-faint hover:text-text-muted"
            )}
          >
            <t.icon className="h-3 w-3" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {elements.length === 0 && (
          <p className="text-[12px] text-text-faint">No {filter} elements found in this document.</p>
        )}
        {elements.map((el) => (
          <div key={el.element_id} className="rounded-lg border border-border-subtle bg-elevated/40 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] text-text-faint">
                p.{el.page_number} {el.ocr && "· OCR"}
              </span>
              {el.section_path.length > 0 && (
                <span className="truncate text-[10px] text-text-faint">{el.section_path.join(" > ")}</span>
              )}
            </div>
            {el.element_type === "table" && el.table_json ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr>
                      {el.table_json.headers.map((h, i) => (
                        <th key={i} className="border-b border-border-subtle px-1.5 py-1 text-left text-text-faint">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {el.table_json.rows.map((row, ri) => (
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
            ) : el.element_type === "figure" && el.figure_path ? (
              <div>
                <img
                  src={figureUrl(documentId, el.figure_path)}
                  alt={el.text || "Extracted figure"}
                  className="max-h-40 rounded border border-border-subtle object-contain"
                />
                {el.text && <p className="mt-1.5 text-[11px] text-text-muted">{el.text}</p>}
              </div>
            ) : (
              <p className="text-[12px] leading-relaxed text-text-muted">{el.text}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated/40 px-3 py-2">
      <p className="text-[10px] text-text-faint">{label}</p>
      <p className="font-display text-[15px] font-semibold text-text">{value}</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-faint">{label}</dt>
      <dd className={cn("truncate text-text-muted", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}
