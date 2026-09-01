"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  Send,
  AlertTriangle,
  CheckCircle2,
  FileText,
  ShieldQuestion,
  Sparkles,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  streamChat,
  type ChatAnswer,
  type ChatEvidenceItem,
  type ChatStreamEvent,
  type CitationValidationSummary,
  type CopilotStage,
} from "@/lib/api";
import { CopilotCorePanel } from "./copilot-core-panel";

const EXAMPLE_QUERIES = [
  "What risks were raised for Contoso?",
  "What is the status of the Contoso pricing proposal?",
  "Did Contoso approve the revised proposal?",
  "Which customers mentioned Acme Corp?",
  "What was Contoso's Q4 2025 revenue?",
];

const STAGE_LABEL: Record<CopilotStage, string> = {
  understanding_query: "Understanding your question",
  retrieving_evidence: "Retrieving evidence",
  reasoning: "Reasoning over passages",
  generating: "Generating grounded answer",
  validating: "Validating citations",
};

const STAGE_ORDER: CopilotStage[] = [
  "understanding_query",
  "retrieving_evidence",
  "reasoning",
  "generating",
  "validating",
];

interface ChatTurn {
  id: string;
  query: string;
  status: "streaming" | "done" | "error";
  stage: CopilotStage | null;
  streamedText: string;
  answer: ChatAnswer | null;
  evidence: ChatEvidenceItem[];
  citationValidation: CitationValidationSummary | null;
  modelName: string | null;
  providerIsFallback: boolean;
  latencyMs: number | null;
  error: string | null;
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-evidence-dim/30 text-evidence border-evidence-dim/60",
  medium: "bg-primary-dim/30 text-primary border-primary-dim/60",
  low: "bg-warning/15 text-warning border-warning/40",
};

function ConfidenceBadge({ confidence }: { confidence: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        CONFIDENCE_STYLE[confidence] ?? CONFIDENCE_STYLE.medium
      )}
    >
      {confidence} confidence
    </span>
  );
}

function CitationChip({ citation }: { citation: { document_id: string; page: number | null } }) {
  return (
    <Link
      href={`/documents?doc=${encodeURIComponent(citation.document_id)}&page=${citation.page ?? ""}`}
      data-testid="citation"
      className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-elevated/70 px-2.5 py-1 text-[11px] text-text-muted transition hover:border-evidence-dim/60 hover:text-evidence"
    >
      <FileText className="h-3 w-3" strokeWidth={1.75} />
      {citation.document_id}
      {citation.page != null && <span className="text-text-faint">· p.{citation.page}</span>}
    </Link>
  );
}

function TurnBubble({ turn }: { turn: ChatTurn }) {
  const stageIdx = turn.stage ? STAGE_ORDER.indexOf(turn.stage) : -1;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-2xl rounded-tr-sm bg-elevated-2 px-4 py-2.5 text-[13px] text-text">
          {turn.query}
        </div>
      </div>

      <div className="flex justify-start">
        <div className="max-w-2xl space-y-3 rounded-2xl rounded-tl-sm border border-border-subtle bg-surface/70 px-4 py-3.5">
          {turn.status === "streaming" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {STAGE_ORDER.map((s, i) => (
                  <span
                    key={s}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      i < stageIdx && "bg-evidence-dim/30 text-evidence",
                      i === stageIdx && "bg-primary-dim/40 text-primary",
                      i > stageIdx && "bg-elevated-2 text-text-faint"
                    )}
                  >
                    {STAGE_LABEL[s]}
                  </span>
                ))}
              </div>
              {turn.streamedText && (
                <p className="text-[13px] leading-relaxed text-text">{turn.streamedText}</p>
              )}
              {!turn.streamedText && (
                <div className="flex items-center gap-2 text-[12px] text-text-faint">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                  {turn.stage ? STAGE_LABEL[turn.stage] : "Working"}…
                </div>
              )}
            </div>
          )}

          {turn.status === "error" && (
            <div className="flex items-start gap-2 text-[13px] text-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{turn.error}</span>
            </div>
          )}

          {turn.status === "done" && turn.answer && (
            <>
              {turn.answer.abstained ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px] text-text">
                  <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
                  <div>
                    <p className="font-medium text-warning">
                      I don&apos;t have sufficient evidence to answer this confidently.
                    </p>
                    {turn.answer.abstention_reason && (
                      <p className="mt-1 text-text-muted">{turn.answer.abstention_reason}</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[13px] leading-relaxed text-text">{turn.answer.answer}</p>

                  {turn.answer.key_findings.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-text-faint">
                        Key findings
                      </p>
                      <ul className="space-y-1">
                        {turn.answer.key_findings.map((f, i) => (
                          <li key={i} className="flex gap-2 text-[12.5px] text-text-muted">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-evidence" strokeWidth={1.75} />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {turn.answer.citations.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-text-faint">
                        Sources
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {turn.answer.citations.map((c, i) => (
                          <CitationChip key={i} citation={c} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
                <ConfidenceBadge confidence={turn.answer.confidence} />
                {turn.citationValidation && turn.citationValidation.stripped > 0 && (
                  <span className="text-[10px] text-text-faint">
                    {turn.citationValidation.stripped} citation
                    {turn.citationValidation.stripped === 1 ? "" : "s"} filtered by validation
                  </span>
                )}
                {turn.modelName && (
                  <span className="ml-auto text-[10px] text-text-faint">
                    {turn.modelName}
                    {turn.providerIsFallback && " (fallback — see ADR 0005)"}
                    {turn.latencyMs != null && ` · ${turn.latencyMs}ms`}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CopilotWorkspace() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversationId] = useState(() => `conv-${Math.random().toString(36).slice(2, 10)}`);
  const [liveStage, setLiveStage] = useState<CopilotStage | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const runQuery = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q || busy) return;

      const id = `turn-${Date.now()}`;
      setTurns((prev) => [
        ...prev,
        {
          id,
          query: q,
          status: "streaming",
          stage: "understanding_query",
          streamedText: "",
          answer: null,
          evidence: [],
          citationValidation: null,
          modelName: null,
          providerIsFallback: false,
          latencyMs: null,
          error: null,
        },
      ]);
      setInput("");
      setBusy(true);
      setLiveStage("understanding_query");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const final = await streamChat(q, {
          conversationId,
          signal: controller.signal,
          onEvent: (event: ChatStreamEvent) => {
            if (event.type === "status") {
              setLiveStage(event.stage);
              updateTurn(id, { stage: event.stage });
            } else if (event.type === "token") {
              setTurns((prev) =>
                prev.map((t) => (t.id === id ? { ...t, streamedText: t.streamedText + event.text } : t))
              );
            }
          },
        });

        updateTurn(id, {
          status: "done",
          answer: final.answer,
          evidence: final.evidence,
          citationValidation: final.citation_validation,
          modelName: final.model_name,
          providerIsFallback: final.provider_is_fallback,
          latencyMs: final.latency_ms,
        });
      } catch (err) {
        updateTurn(id, {
          status: "error",
          error: err instanceof Error ? err.message : "Something went wrong.",
        });
      } finally {
        setBusy(false);
        setLiveStage(null);
      }
    },
    [busy, conversationId, updateTurn]
  );

  return (
    <div className="grid grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-[1fr_300px]">
      <div className="flex min-h-[560px] flex-col rounded-xl border border-border-subtle bg-surface/40">
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <Sparkles className="h-8 w-8 text-primary" strokeWidth={1.5} />
              <div>
                <p className="font-display text-sm font-medium text-text">
                  Ask a grounded question across authorized call reports
                </p>
                <p className="mt-1 max-w-sm text-[12.5px] text-text-muted">
                  Every answer is cited to a specific document and page — or the Copilot tells
                  you plainly when it doesn&apos;t have enough evidence.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => runQuery(q)}
                    className="rounded-full border border-border-subtle bg-elevated/60 px-3 py-1.5 text-[12px] text-text-muted transition hover:border-primary-dim hover:text-text"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn) => (
            <TurnBubble key={turn.id} turn={turn} />
          ))}
        </div>

        <div className="border-t border-border-subtle p-3">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runQuery(input);
              }}
              disabled={busy}
              placeholder="Ask about a customer, risk, commitment, or metric…"
              aria-label="Ask the Copilot a question"
              data-testid="copilot-input"
              className="w-full rounded-lg border border-border-subtle bg-elevated/60 px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint outline-none focus:border-primary-dim disabled:opacity-60"
            />
            <button
              onClick={() => runQuery(input)}
              disabled={busy || !input.trim()}
              aria-label={busy ? "Sending question" : "Send question"}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-bg transition disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Send className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="hidden h-[400px] lg:block">
        <CopilotCorePanel stage={liveStage} />
      </div>
    </div>
  );
}
