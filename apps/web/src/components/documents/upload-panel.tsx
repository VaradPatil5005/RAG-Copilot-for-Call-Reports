"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, FileText, Loader2, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadDocuments, type UploadResultItem } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-context";

// Must match ALLOWED_EXTENSIONS in apps/api/app/services/document_conversion.py.
// The server re-checks every file by its actual content (magic bytes), so
// this list is a convenience for the user, not the security boundary.
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc"];
const ACCEPT_ATTR =
  ".pdf,.docx,.doc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FILE_BYTES = 100 * 1024 * 1024; // mirrors validation.MAX_FILE_SIZE_BYTES
const REJECT_TOAST_MS = 3000;

function isAcceptedFile(f: File): boolean {
  const name = f.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

interface UploadPanelProps {
  onUploaded: () => void;
}

export function UploadPanel({ onUploaded }: UploadPanelProps) {
  const { isAuthenticated, openAuthModal } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResultItem[] | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [accountOwner, setAccountOwner] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [classification, setClassification] = useState("internal");
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejectNotice, setRejectNotice] = useState<string | null>(null);
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
  }, []);

  const showRejectNotice = useCallback((message: string) => {
    setRejectNotice(message);
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setRejectNotice(null), REJECT_TOAST_MS);
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const all = Array.from(incoming);
      const wrongType = all.filter((f) => !isAcceptedFile(f));
      const tooBig = all.filter((f) => isAcceptedFile(f) && f.size > MAX_FILE_BYTES);
      const accepted = all.filter((f) => isAcceptedFile(f) && f.size <= MAX_FILE_BYTES);

      if (wrongType.length > 0) {
        const names = wrongType.map((f) => f.name).join(", ");
        showRejectNotice(
          `File cannot be accepted: ${names}. Only PDF and Word documents (.pdf, .docx, .doc) are allowed.`
        );
      } else if (tooBig.length > 0) {
        showRejectNotice(`File cannot be accepted: ${tooBig.map((f) => f.name).join(", ")} exceeds 100 MB.`);
      }
      if (accepted.length > 0) {
        setPending((prev) => [...prev, ...accepted]);
        setResults(null);
      }
    },
    [showRejectNotice]
  );

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

    if (!isAuthenticated) {
      openAuthModal("Sign in to index confidential call report PDFs into your organization vault", () => {
        submit();
      });
      return;
    }

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
          Drag &amp; drop call reports (PDF or Word), or click to browse
        </p>
        <p className="text-[11px] text-text-faint">
          .pdf, .docx, .doc · up to 100 MB each · auto-validates, extracts layout, and indexes on arrival
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          aria-label="Upload call report PDF or Word documents"
          data-testid="document-upload-input"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      </div>

      {rejectNotice && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="upload-reject-notice"
          className="mt-3 flex items-start gap-2 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{rejectNotice}</span>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-4 rounded-xl border border-border-subtle bg-elevated/40 p-3">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-border-subtle text-[11px]">
            <span className="font-medium text-text">
              Selected Documents ({pending.length})
            </span>
            <button
              onClick={() => setPending([])}
              className="text-[11px] text-error hover:underline transition-colors cursor-pointer"
            >
              Clear all
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {pending.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface/80 px-3 py-2"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.75} />
                  <span className="truncate text-[12px] text-text font-medium">{f.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-text-faint">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePending(i);
                  }}
                  aria-label={`Delete ${f.name}`}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-text-faint hover:bg-error/15 hover:text-error transition-all"
                  title="Delete from upload queue"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Delete</span>
                </button>
              </div>
            ))}
          </div>
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
          className="flex items-center gap-2 rounded-lg bg-brand-fill hover:bg-brand-press px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-40"
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
