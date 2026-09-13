"use client";

/**
 * Copilot Workspace — Perplexity AI-inspired 3-column chat interface.
 *
 * Layout: [Sessions Sidebar] | [Main Chat Area] | [Sources Panel]
 *
 * Features:
 * - Inline numbered citations [1][2][3] with hover-highlight to sources
 * - Clean answer formatting (no bullet-list key findings)
 * - Collapsible thinking/reasoning steps
 * - Chat session history with localStorage persistence
 * - Sources panel with snippet previews
 * - Feedback thumbs on hover only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotCorePanel } from "./copilot-core-panel";
import {
  Send,
  AlertTriangle,
  ShieldQuestion,
  Sparkles,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronRight,
  Zap,
  Search as SearchIcon,
  BookOpen,
  Brain,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  streamChat,
  submitChatFeedback,
  type ChatAnswer,
  type ChatEvidenceItem,
  type ChatMessageIn,
  type ChatStreamEvent,
  type CitationValidationSummary,
  type CopilotStage,
} from "@/lib/api";
import { CopilotSessions } from "./copilot-sessions";
import { CopilotSources } from "./copilot-sources";
import {
  generateSessionId,
  generateSessionTitle,
  saveSession,
  getSession,
  type StoredTurn,
  type ChatSession,
} from "./copilot-store";

const EXAMPLE_QUERIES = [
  "What is the overall status of the Apex supplier quality call?",
  "List all agreed actions with owners and due dates",
  "Which domains have accessibility-related actions?",
  "What risks were raised across all reports?",
  "Summarize the CareBridge clinical trial visit",
];

const STAGE_LABEL: Record<CopilotStage, string> = {
  understanding_query: "Understanding",
  retrieving_evidence: "Searching documents",
  reasoning: "Analyzing",
  generating: "Writing answer",
  validating: "Verifying citations",
};

const STAGE_ICON: Record<CopilotStage, LucideIcon> = {
  understanding_query: Brain,
  retrieving_evidence: SearchIcon,
  reasoning: BookOpen,
  generating: Sparkles,
  validating: CheckCircle2,
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
  traceId?: string;
  feedbackRating?: 1 | -1;
  feedbackCategory?: string;
  feedbackSubmitted?: boolean;
}

/* ---------- Inline citation rendering ---------- */

function renderAnswerWithCitations(
  answer: string,
  citationCount: number,
  hoveredSource: number | null,
  onHoverCitation: (index: number | null) => void
): React.ReactNode[] {
  // Find citation patterns like [1], [2], [3] — or insert them based on
  // paragraph boundaries if the LLM didn't generate inline numbers.
  // The LLM output typically doesn't have [1][2] markers, so we add
  // citation references at sentence boundaries proportionally.
  const nodes: React.ReactNode[] = [];

  if (citationCount === 0) {
    nodes.push(<span key="text">{answer}</span>);
    return nodes;
  }

  // Check if the answer already has [N] style citations
  const citationRegex = /\[(\d+)\]/g;
  const existingCitations = answer.match(citationRegex);

  if (existingCitations && existingCitations.length > 0) {
    // Answer has inline citations — render them as badges
    let lastIndex = 0;
    let match;
    const regex = /\[(\d+)\]/g;
    let keyIdx = 0;

    while ((match = regex.exec(answer)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(<span key={`t-${keyIdx}`}>{answer.slice(lastIndex, match.index)}</span>);
      }
      const num = parseInt(match[1], 10) - 1;
      nodes.push(
        <CitationBadge
          key={`c-${keyIdx}`}
          index={num}
          isHighlighted={hoveredSource === num}
          onHover={onHoverCitation}
        />
      );
      lastIndex = match.index + match[0].length;
      keyIdx++;
    }
    if (lastIndex < answer.length) {
      nodes.push(<span key={`t-end`}>{answer.slice(lastIndex)}</span>);
    }
  } else {
    // No inline citations — add them at the end of the answer
    nodes.push(<span key="text">{answer}</span>);
    nodes.push(<span key="gap">{" "}</span>);
    for (let i = 0; i < Math.min(citationCount, 8); i++) {
      nodes.push(
        <CitationBadge
          key={`c-${i}`}
          index={i}
          isHighlighted={hoveredSource === i}
          onHover={onHoverCitation}
        />
      );
    }
  }

  return nodes;
}

function CitationBadge({
  index,
  isHighlighted,
  onHover,
}: {
  index: number;
  isHighlighted: boolean;
  onHover: (index: number | null) => void;
}) {
  const scrollToSource = () => {
    const el = document.getElementById(`source-card-${index}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <button
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onClick={scrollToSource}
      className={cn(
        "citation-badge",
        isHighlighted && "citation-badge-active"
      )}
      aria-label={`Source ${index + 1}`}
    >
      {index + 1}
    </button>
  );
}

/* ---------- Thinking Steps (collapsed) ---------- */

function ThinkingSteps({
  stage,
  isStreaming,
}: {
  stage: CopilotStage | null;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const stageIdx = stage ? STAGE_ORDER.indexOf(stage) : -1;

  if (!isStreaming && stageIdx < 0) {
    return (
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-text-faint hover:text-text-muted transition-colors mb-2"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
        )}
        <Zap className="h-3 w-3 text-evidence" strokeWidth={2} />
        View reasoning steps
      </button>
    );
  }

  // During streaming — show compact progress
  return (
    <div className="mb-3">
      <div className="flex items-center gap-3">
        {STAGE_ORDER.map((s, i) => {
          const Icon = STAGE_ICON[s];
          const isDone = i < stageIdx;
          const isCurrent = i === stageIdx;
          return (
            <div
              key={s}
              className={cn(
                "flex items-center gap-1.5 text-[11px] font-medium transition-all duration-300",
                isDone && "text-evidence",
                isCurrent && "text-primary",
                !isDone && !isCurrent && "text-text-faint/50"
              )}
            >
              {isCurrent ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              ) : (
                <Icon className="h-3 w-3" strokeWidth={2} />
              )}
              <span className="hidden sm:inline">{STAGE_LABEL[s]}</span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-[2px] w-full rounded-full bg-elevated-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-evidence transition-all duration-500 ease-out"
          style={{ width: `${((stageIdx + 1) / STAGE_ORDER.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ---------- Answer Bubble (Perplexity-style) ---------- */

function TurnBubble({
  turn,
  onFeedback,
  hoveredSource,
  onHoverSource,
}: {
  turn: ChatTurn;
  onFeedback: (turnId: string, rating: 1 | -1, category?: string) => void;
  hoveredSource: number | null;
  onHoverSource: (index: number | null) => void;
}) {
  const [showIssuePicker, setShowIssuePicker] = useState(false);

  const ISSUE_CATEGORIES = [
    { label: "Incorrect facts", id: "incorrect_data" },
    { label: "Wrong citation", id: "wrong_citation" },
    { label: "Unsupported claim", id: "unsupported_claim" },
    { label: "Missing context", id: "missing_context" },
  ];

  return (
    <div className="copilot-turn">
      {/* User query */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <span className="text-[11px] font-bold">You</span>
        </div>
        <p className="pt-1 text-[14px] font-medium text-text">{turn.query}</p>
      </div>

      {/* AI Answer */}
      <div className="pl-10">
        {/* Thinking steps */}
        {turn.status === "streaming" && (
          <ThinkingSteps stage={turn.stage} isStreaming />
        )}

        {/* Streaming text */}
        {turn.status === "streaming" && turn.streamedText && (
          <p className="copilot-answer-text animate-in fade-in">{turn.streamedText}</p>
        )}

        {/* Loading spinner when no text yet */}
        {turn.status === "streaming" && !turn.streamedText && !turn.stage && (
          <div className="flex items-center gap-2 text-[12px] text-text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            Working…
          </div>
        )}

        {/* Error state */}
        {turn.status === "error" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-error/25 bg-error/8 px-4 py-3 text-[13px]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" strokeWidth={1.75} />
            <span className="text-text-muted">{turn.error}</span>
          </div>
        )}

        {/* Completed answer */}
        {turn.status === "done" && turn.answer && (
          <>
            {/* Collapsed thinking steps toggle */}
            <ThinkingSteps stage={null} isStreaming={false} />

            {turn.answer.abstained ? (
              /* Abstention */
              <div className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3">
                <ShieldQuestion className="mt-0.5 h-4.5 w-4.5 shrink-0 text-warning" strokeWidth={1.75} />
                <div>
                  <p className="text-[13px] font-medium text-warning">
                    I don&apos;t have sufficient evidence to answer this confidently.
                  </p>
                  {turn.answer.abstention_reason && (
                    <p className="mt-1.5 text-[12px] text-text-muted leading-relaxed">
                      {turn.answer.abstention_reason}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              /* Full answer with inline citations */
              <div className="space-y-3">
                <div className="copilot-answer-text">
                  {renderAnswerWithCitations(
                    turn.answer.answer,
                    turn.answer.citations.length,
                    hoveredSource,
                    onHoverSource
                  )}
                </div>
              </div>
            )}

            {/* Footer: confidence + model + feedback */}
            <div className="copilot-answer-footer group/footer">
              <div className="flex items-center gap-2">
                {/* Confidence */}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    turn.answer.confidence === "high" && "bg-evidence/12 text-evidence",
                    turn.answer.confidence === "medium" && "bg-primary/12 text-primary",
                    turn.answer.confidence === "low" && "bg-warning/12 text-warning"
                  )}
                >
                  {turn.answer.confidence}
                </span>

                {turn.citationValidation && turn.citationValidation.stripped > 0 && (
                  <span className="text-[10px] text-text-faint">
                    {turn.citationValidation.stripped} citation{turn.citationValidation.stripped === 1 ? "" : "s"} filtered
                  </span>
                )}

                {turn.modelName && (
                  <span className="text-[10px] text-text-faint">
                    {turn.modelName}
                    {turn.providerIsFallback && " (fallback)"}
                    {turn.latencyMs != null && ` · ${(turn.latencyMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>

              {/* Feedback — appears on hover */}
              <div className="flex items-center gap-1 opacity-0 group-hover/footer:opacity-100 transition-opacity">
                {turn.feedbackSubmitted ? (
                  <span className="text-[10px] text-text-faint italic">
                    {turn.feedbackRating === 1 ? "✓ Helpful" : "✓ Noted"}
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => onFeedback(turn.id, 1)}
                      title="Helpful"
                      className="rounded-md p-1.5 text-text-faint hover:bg-evidence/15 hover:text-evidence transition-colors"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => setShowIssuePicker(!showIssuePicker)}
                      title="Report issue"
                      className="rounded-md p-1.5 text-text-faint hover:bg-error/15 hover:text-error transition-colors"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Issue picker */}
            {showIssuePicker && !turn.feedbackSubmitted && (
              <div className="mt-2 ml-0 rounded-xl border border-border-subtle bg-elevated/60 p-3 text-[11px]">
                <p className="mb-2 font-medium text-text-muted">What was the issue?</p>
                <div className="flex flex-wrap gap-1.5">
                  {ISSUE_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        onFeedback(turn.id, -1, cat.id);
                        setShowIssuePicker(false);
                      }}
                      className="rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-text-muted hover:border-error/40 hover:text-error transition-colors"
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Main CopilotWorkspace ---------- */

export function CopilotWorkspace() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [conversationId, setConversationId] = useState(() => `conv-${Math.random().toString(36).slice(2, 10)}`);
  const [hoveredSource, setHoveredSource] = useState<number | null>(null);
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [liveStage, setLiveStage] = useState<CopilotStage | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const updateTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Persist session to localStorage after each completed turn
  const persistSession = useCallback(
    (currentTurns: ChatTurn[]) => {
      const doneTurns = currentTurns.filter((t) => t.status === "done" && t.answer);
      if (doneTurns.length === 0) return;

      const session: ChatSession = {
        id: sessionId,
        title: generateSessionTitle(currentTurns[0]?.query ?? "New Chat"),
        createdAt: parseInt(sessionId.split("-")[1]) || Date.now(),
        updatedAt: Date.now(),
        turns: doneTurns.map((t): StoredTurn => ({
          id: t.id,
          query: t.query,
          answer: t.answer,
          evidence: t.evidence,
          citationValidation: t.citationValidation,
          modelName: t.modelName,
          providerIsFallback: t.providerIsFallback,
          latencyMs: t.latencyMs,
          traceId: t.traceId,
          feedbackRating: t.feedbackRating,
          feedbackSubmitted: t.feedbackSubmitted,
        })),
      };
      saveSession(session);
      setSessionRefresh((n) => n + 1);
    },
    [sessionId]
  );

  const handleFeedback = useCallback(
    async (turnId: string, rating: 1 | -1, category?: string) => {
      const turn = turns.find((t) => t.id === turnId);
      if (!turn || !turn.traceId || turn.feedbackSubmitted) return;
      updateTurn(turnId, {
        feedbackRating: rating,
        feedbackCategory: category,
        feedbackSubmitted: true,
      });
      try {
        await submitChatFeedback({
          trace_id: turn.traceId,
          rating,
          conversation_id: conversationId,
          issue_category: category,
        });
      } catch (err) {
        console.error("Failed to submit feedback", err);
      }
    },
    [turns, conversationId, updateTurn]
  );

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

      // Prepare conversation history from completed turns for conversational multi-turn context
      const historyMessages: ChatMessageIn[] = [];
      for (const t of turns) {
        if (t.query) {
          historyMessages.push({ role: "user", content: t.query });
        }
        if (t.answer?.answer) {
          historyMessages.push({
            role: "assistant",
            content: t.answer.answer,
            evidence_chunk_ids: t.evidence?.map((e) => e.chunk_id) || [],
          });
        }
      }

      try {
        const final = await streamChat(q, {
          conversationId,
          messages: historyMessages,
          signal: controller.signal,
          onEvent: (event: ChatStreamEvent) => {
            if (event.type === "status") {
              updateTurn(id, { stage: event.stage });
              setLiveStage(event.stage);
            } else if (event.type === "token") {
              setTurns((prev) =>
                prev.map((t) => (t.id === id ? { ...t, streamedText: t.streamedText + event.text } : t))
              );
            }
          },
        });

        const updatedTurns = (prev: ChatTurn[]): ChatTurn[] =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: "done" as const,
                  traceId: final.trace_id,
                  answer: final.answer,
                  evidence: final.evidence,
                  citationValidation: final.citation_validation,
                  modelName: final.model_name,
                  providerIsFallback: final.provider_is_fallback,
                  latencyMs: final.latency_ms,
                }
              : t
          );

        setTurns((prev) => {
          const newTurns = updatedTurns(prev);
          // Persist after state update
          setTimeout(() => persistSession(newTurns), 50);
          return newTurns;
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
    [busy, conversationId, turns, updateTurn, persistSession]
  );

  // Load a saved session
  const handleSelectSession = useCallback((id: string) => {
    const session = getSession(id);
    if (!session) return;

    setSessionId(session.id);
    setConversationId(`conv-${session.id.slice(-8)}`);
    setTurns(
      session.turns.map((t): ChatTurn => ({
        ...t,
        status: "done",
        stage: null,
        streamedText: "",
        error: null,
        providerIsFallback: t.providerIsFallback ?? false,
      }))
    );
    setHoveredSource(null);
    setLiveStage(null);
    inputRef.current?.focus();
  }, []);

  // Start a new chat
  const handleNewChat = useCallback(() => {
    setSessionId(generateSessionId());
    setConversationId(`conv-${Math.random().toString(36).slice(2, 10)}`);
    setTurns([]);
    setHoveredSource(null);
    setLiveStage(null);
    inputRef.current?.focus();
  }, []);

  // Get citations/evidence for the last completed turn (for the sources panel)
  const lastDoneTurn = [...turns].reverse().find((t) => t.status === "done" && t.answer && !t.answer.abstained);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Sessions Sidebar */}
      <CopilotSessions
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        refreshTrigger={sessionRefresh}
      />

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto">
          {turns.length === 0 ? (
            /* Empty state */
            <div className="flex h-full flex-col items-center justify-center px-6">
              <div className="max-w-xl text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-subtle bg-elevated-1 shadow-inner relative">
                  <Sparkles className="h-7 w-7 text-primary" strokeWidth={1.75} />
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-evidence shadow-[0_0_8px_rgba(79,209,197,0.9)] animate-pulse" />
                </div>
                <div className="flex items-center justify-center gap-2 mb-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-evidence shadow-[0_0_6px_rgba(79,209,197,0.8)]" />
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-text-faint">
                    SYS // ZERO-G REASONING CORE
                  </span>
                </div>
                <h2 className="font-display text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                  What would you like to know?
                </h2>
                <p className="mt-2 text-[13px] text-text-muted max-w-md mx-auto leading-relaxed">
                  Ask questions across your authorized call reports. Every answer is
                  grounded with page-level citations.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {EXAMPLE_QUERIES.map((q) => (
                    <button
                      key={q}
                      onClick={() => runQuery(q)}
                      className="copilot-suggestion-chip"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-6 py-6 space-y-2">
              {turns.map((turn) => (
                <TurnBubble
                  key={turn.id}
                  turn={turn}
                  onFeedback={handleFeedback}
                  hoveredSource={hoveredSource}
                  onHoverSource={setHoveredSource}
                />
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border-subtle bg-surface/60 backdrop-blur-sm px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="copilot-input-container">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    runQuery(input);
                  }
                }}
                disabled={busy}
                placeholder="Ask about call reports..."
                aria-label="Ask the Copilot a question"
                data-testid="copilot-input"
                className="copilot-input"
              />
              <button
                onClick={() => runQuery(input)}
                disabled={busy || !input.trim()}
                aria-label={busy ? "Sending" : "Send"}
                className="copilot-send-btn"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Send className="h-4 w-4" strokeWidth={2} />
                )}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-text-faint">
              Answers are grounded in your documents. Always verify critical decisions.
            </p>
          </div>
        </div>
      </div>

      {/* Right Intelligence Panel: 3D AI Knowledge Core Activity + Perplexity-style Sources */}
      <div className="hidden xl:flex w-[340px] shrink-0 flex-col border-l border-border-subtle bg-surface/30 overflow-hidden">
        {/* 3D Knowledge Core Activity Panel */}
        <div className="h-[250px] shrink-0 border-b border-border-subtle p-3 bg-surface/40">
          <CopilotCorePanel stage={liveStage} />
        </div>

        {/* Grounded Evidence Sources */}
        <div className="flex-1 overflow-y-auto p-4">
          <CopilotSources
            citations={lastDoneTurn?.answer?.citations ?? []}
            evidence={lastDoneTurn?.evidence ?? []}
            traceId={lastDoneTurn?.traceId}
            highlightedIndex={hoveredSource}
            onHoverSource={setHoveredSource}
          />
        </div>
      </div>
    </div>
  );
}
