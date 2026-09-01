"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileText, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadDocuments, type UploadResultItem } from "@/lib/api";

interface UploadPanelProps {
  onUploaded: () => void;
}

export function UploadPanel({ onUploaded }: UploadPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResultItem[] | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [accountOwner, setAccountOwner] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [classification, setClassification] = useState("internal");
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    setPending((prev) => [...prev, ...arr]);
    setResults(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removePending = (idx: number) => {
    setPending((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (pending.length === 0) return;
    setBusy(true);
    try {
      const res = await uploadDocuments(pending, {
        customer_name: customerName || undefined,
        account_owner: accountOwner || undefined,
        meeting_date: meetingDate || undefined,
        classification,
      });
      setResults(res);
      setPending([]);
      onUploaded();
    } catch (err) {
      setResults([
        {
          filename: "upload",
          status: "rejected",
          message: err instanceof Error ? err.message : "Upload failed",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-8 rounded-xl border border-border-subtle bg-surface/60 p-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragOver ? "border-primary bg-primary-dim/10" : "border-border-subtle hover:border-border"
        )}
      >
        <UploadCloud
          className={cn("h-7 w-7", dragOver ? "text-primary" : "text-text-faint")}
          strokeWidth={1.5}
        />
        <p className="text-[13px] font-medium text-text">
          Drag &amp; drop call report PDFs, or click to browse
        </p>
        <p className="text-[11px] text-text-faint">
          Batch upload supported · auto-validates, extracts layout, and indexes on arrival
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          aria-label="Upload call report PDFs"
          data-testid="document-upload-input"
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {pending.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {pending.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded-lg border border-border-subtle bg-elevated/60 px-3 py-2"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <FileText className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={1.75} />
                <span className="truncate text-[12px] text-text-muted">{f.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-text-faint">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removePending(i);
                }}
                aria-label={`Remove ${f.name}`}
                className="rounded p-1 text-text-faint hover:bg-elevated-2 hover:text-text"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Customer">
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Contoso"
            className={inputCls}
          />
        </Field>
        <Field label="Account owner">
          <input
            value={accountOwner}
            onChange={(e) => setAccountOwner(e.target.value)}
            placeholder="e.g. Alice Chen"
            className={inputCls}
          />
        </Field>
        <Field label="Meeting date">
          <input
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Classification">
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
            className={inputCls}
          >
            <option value="internal">Internal</option>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted</option>
            <option value="public">Public</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-[11px] text-text-faint">
          {pending.length > 0
            ? `${pending.length} file${pending.length > 1 ? "s" : ""} ready to upload`
            : "Metadata applies to all files in this batch"}
        </p>
        <button
          onClick={submit}
          disabled={pending.length === 0 || busy}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[12px] font-medium text-bg transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? "Uploading…" : "Upload & process"}
        </button>
      </div>

      {results && (
        <div className="mt-4 space-y-1 border-t border-border-subtle pt-3">
          {results.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">{r.filename}</span>
              <span
                className={cn(
                  "font-medium",
                  r.status === "queued" && "text-evidence",
                  r.status === "duplicate" && "text-text-faint",
                  r.status === "rejected" && "text-error"
                )}
              >
                {r.status === "queued" ? "Queued for processing" : r.message || r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
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
