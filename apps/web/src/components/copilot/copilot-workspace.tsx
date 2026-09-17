"use client";

/**
 * Copilot Workspace — Perplexity AI-inspired chat interface.
 *
 * Features:
 * - Clean, wide, spacious workspace (removed fixed 3D orb column).
 * - Inline Perplexity-style citation pills with interactive hover popover card (< 1/N > carousel, domain, snippet, trust badge).
 * - On-demand collapsible Sources drawer (opens when toggled or clicked).
 * - Top action bar with Share link and full options dropdown (...):
 *   - Session title & metadata (Created by, Last updated)
 *   - Pin / Unpin session
 *   - Add to project
 *   - Rename Session (modal dialog)
 *   - Export as PDF
 *   - Export as Markdown
 *   - Export as DOCX
 *   - Delete session
 * - Attachment upload queue (+) with individual delete choices.
 * - Feedback and conversation persistence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
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
  Glasses,
  Share2,
  MoreHorizontal,
  Pin,
  FolderPlus,
  Pencil,
  FileDown,
  FileText,
  Trash2,
  X,
  Check,
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
import { CitationPillWithPopover } from "./copilot-citation-popover";
import { DocumentViewerModal } from "@/components/documents/document-viewer-modal";
import {
  exportToMarkdown,
  exportToPdf,
  exportToDocx,
  copyShareLink,
} from "./copilot-export";
import {
  generateSessionId,
  generateSessionTitle,
  saveSession,
  getSession,
  renameSession,
  togglePinSession,
  deleteSession,
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

/* ---------- Perplexity-Style Inline Citation Rendering ---------- */

function renderAnswerWithCitations(
  answer: string,
  evidence: ChatEvidenceItem[],
  onOpenSourcesDrawer: () => void,
  onOpenDocument?: (docId: string, page?: number, snippet?: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  if (!evidence || evidence.length === 0) {
    nodes.push(<span key="text">{answer}</span>);
    return nodes;
  }

  // Check if LLM output has [1], [2] citation markers
  const citationRegex = /\[(\d+)\]/g;
  const matches = [...answer.matchAll(citationRegex)];

  if (matches.length > 0) {
    let lastIndex = 0;
    matches.forEach((match, idx) => {
      const matchIndex = match.index ?? 0;
      if (matchIndex > lastIndex) {
        nodes.push(
          <span key={`text-${idx}`}>{answer.slice(lastIndex, matchIndex)}</span>
        );
      }

      const num = parseInt(match[1], 10) - 1;
      const matchedEvidence = evidence[num] ? [evidence[num]] : evidence;

      nodes.push(
        <CitationPillWithPopover
          key={`cit-${idx}`}
          sources={matchedEvidence}
          startIndex={num >= 0 ? num : 0}
          onOpenDocument={onOpenDocument}
        />
      );

      lastIndex = matchIndex + match[0].length;
    });

    if (lastIndex < answer.length) {
      nodes.push(<span key="text-end">{answer.slice(lastIndex)}</span>);
    }
  } else {
    // Answer has no inline markers; render answer text followed by grouped source pills
    nodes.push(<span key="text-plain">{answer}</span>);
    nodes.push(<span key="space"> </span>);
    nodes.push(
      <CitationPillWithPopover
        key="cit-grouped"
        sources={evidence}
        onOpenDocument={onOpenDocument}
      />
    );
  }

  return nodes;
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
        className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors mb-2"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
        )}
        <Zap className="h-3 w-3 text-white" strokeWidth={2} />
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
                isDone && "text-[#d4d4d8]",
                isCurrent && "text-white font-semibold",
                !isDone && !isCurrent && "text-text-faint/50"
              )}
            >
              {isCurrent ? (
                <Loader2 className="h-3 w-3 animate-spin text-white" strokeWidth={2} />
              ) : (
                <Icon className="h-3 w-3" strokeWidth={2} />
              )}
              <span className="hidden sm:inline">{STAGE_LABEL[s]}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-evidence transition-all duration-500 ease-out shadow-[0_0_8px_rgba(79,209,197,0.6)]"
          style={{ width: `${((stageIdx + 1) / STAGE_ORDER.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ---------- Answer Bubble ---------- */

function TurnBubble({
  turn,
  onFeedback,
  onOpenSources,
  onOpenDocument,
}: {
  turn: ChatTurn;
  onFeedback: (turnId: string, rating: 1 | -1, category?: string) => void;
  onOpenSources: () => void;
  onOpenDocument?: (docId: string, page?: number, snippet?: string) => void;
}) {
  const [showIssuePicker, setShowIssuePicker] = useState(false);

  const ISSUE_CATEGORIES = [
    { label: "Incorrect facts", id: "incorrect_data" },
    { label: "Wrong citation", id: "wrong_citation" },
    { label: "Unsupported claim", id: "unsupported_claim" },
    { label: "Missing context", id: "missing_context" },
  ];

  return (
    <div className="copilot-turn border-b border-white/[0.04] pb-6 mb-6">
      {/* User query */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-[11px] font-bold">
          You
        </div>
        <p className="pt-0.5 text-[15px] font-semibold text-white tracking-tight leading-snug">
          {turn.query}
        </p>
      </div>

      {/* AI Answer */}
      <div className="pl-10">
        {turn.status === "streaming" && (
          <ThinkingSteps stage={turn.stage} isStreaming />
        )}

        {turn.status === "streaming" && turn.streamedText && (
          <p className="copilot-answer-text animate-in fade-in leading-relaxed text-zinc-200">
            {turn.streamedText}
          </p>
        )}

        {turn.status === "streaming" && !turn.streamedText && !turn.stage && (
          <div className="flex items-center gap-2 text-[12px] text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={1.75} />
            Analyzing verified call reports…
          </div>
        )}

        {turn.status === "error" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-error/25 bg-error/8 px-4 py-3 text-[13px]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" strokeWidth={1.75} />
            <span className="text-text-muted">{turn.error}</span>
          </div>
        )}

        {turn.status === "done" && turn.answer && (
          <>
            <ThinkingSteps stage={null} isStreaming={false} />

            {turn.answer.abstained ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3">
                <ShieldQuestion className="mt-0.5 h-4.5 w-4.5 shrink-0 text-warning" strokeWidth={1.75} />
                <div>
                  <p className="text-[13px] font-medium text-warning">
                    I don&apos;t have sufficient evidence in authorized call reports to answer this confidently.
                  </p>
                  {turn.answer.abstention_reason && (
                    <p className="mt-1.5 text-[12px] text-text-muted leading-relaxed">
                      {turn.answer.abstention_reason}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="copilot-answer-text leading-relaxed text-zinc-200 text-[14px]">
                  {renderAnswerWithCitations(
                    turn.answer.answer,
                    turn.evidence,
                    onOpenSources,
                    onOpenDocument
                  )}
                </div>
              </div>
            )}

            {/* Footer: confidence + model + feedback */}
            <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-400">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase rounded-full px-2.5 py-0.5 border font-semibold",
                    turn.answer.confidence === "high" && "bg-white/10 text-white border-white/20",
                    turn.answer.confidence === "medium" && "bg-white/[0.06] text-[#d4d4d8] border-white/10",
                    turn.answer.confidence === "low" && "bg-white/[0.03] text-[#71717a] border-white/10"
                  )}
                >
                  {turn.answer.confidence} Confidence
                </span>

                {turn.evidence && turn.evidence.length > 0 && (
                  <button
                    onClick={onOpenSources}
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] px-2 py-0.5 rounded border border-white/[0.06] transition-colors"
                  >
                    <BookOpen className="h-3 w-3 text-primary" />
                    <span>{turn.evidence.length} sources</span>
                  </button>
                )}

                {turn.modelName && (
                  <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline">
                    {turn.modelName}
                    {turn.latencyMs != null && ` · ${(turn.latencyMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </div>

              {/* Thumbs Feedback */}
              <div className="flex items-center gap-1">
                {turn.feedbackSubmitted ? (
                  <span className="text-[10px] text-zinc-400 italic">
                    {turn.feedbackRating === 1 ? "✓ Helpful" : "✓ Noted"}
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => onFeedback(turn.id, 1)}
                      title="Helpful"
                      className="rounded p-1 text-zinc-500 hover:bg-evidence/15 hover:text-evidence transition-colors"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => setShowIssuePicker(!showIssuePicker)}
                      title="Report issue"
                      className="rounded p-1 text-zinc-500 hover:bg-error/15 hover:text-error transition-colors"
                    >
                      <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {showIssuePicker && !turn.feedbackSubmitted && (
              <div className="mt-2 rounded-xl border border-border-subtle bg-elevated/60 p-3 text-[11px]">
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
  const { user, isAuthenticated, openAuthModal, isIncognito, toggleIncognito } = useAuth();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [conversationId, setConversationId] = useState(() => `conv-${Math.random().toString(36).slice(2, 10)}`);
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  const [sessionRefresh, setSessionRefresh] = useState(0);

  // Sources side-drawer open/close state
  const [sourcesDrawerOpen, setSourcesDrawerOpen] = useState(false);

  // Full Document Viewer modal state
  const [activeViewerDoc, setActiveViewerDoc] = useState<{
    documentId: string;
    page?: number | null;
    snippet?: string | null;
  } | null>(null);

  const handleOpenDocument = useCallback((docId: string, page?: number, snippet?: string) => {
    setActiveViewerDoc({ documentId: docId, page: page ?? null, snippet: snippet ?? null });
  }, []);

  // Options menu (...) and Rename modal
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameInputValue, setRenameInputValue] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionsMenuRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close options menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target as Node)) {
        setOptionsMenuOpen(false);
      }
    }
    if (optionsMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [optionsMenuOpen]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const updateTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Persist session to localStorage
  const persistSession = useCallback(
    (currentTurns: ChatTurn[]) => {
      const doneTurns = currentTurns.filter((t) => t.status === "done" && t.answer);
      if (doneTurns.length === 0) return;

      const existing = getSession(sessionId);
      const title = existing?.customTitle
        ? existing.title
        : generateSessionTitle(currentTurns[0]?.query ?? "New Chat");

      setSessionTitle(title);

      const session: ChatSession = {
        id: sessionId,
        title,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        pinned: existing?.pinned,
        customTitle: existing?.customTitle,
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
      if (!isIncognito) {
        saveSession(session);
        setSessionRefresh((n) => n + 1);
      }
    },
    [sessionId, isIncognito]
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

      if (!isAuthenticated) {
        const preview = q.length > 42 ? `${q.slice(0, 42)}...` : q;
        openAuthModal(`Sign in to query confidential reports: "${preview}"`, () => {
          runQuery(q);
        });
        return;
      }

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

      const controller = new AbortController();
      abortRef.current = controller;

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
          isIncognito,
          onEvent: (event: ChatStreamEvent) => {
            if (event.type === "status") {
              updateTurn(id, { stage: event.stage });
            } else if (event.type === "token") {
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === id ? { ...t, streamedText: t.streamedText + event.text } : t
                )
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
      }
    },
    [busy, isAuthenticated, conversationId, turns, updateTurn, persistSession, isIncognito, openAuthModal]
  );

  // Load a saved session
  const handleSelectSession = useCallback((id: string) => {
    const session = getSession(id);
    if (!session) return;

    setSessionId(session.id);
    setSessionTitle(session.title);
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
    inputRef.current?.focus();
  }, []);

  // Start a new chat
  const handleNewChat = useCallback(() => {
    setSessionId(generateSessionId());
    setSessionTitle("New Chat");
    setConversationId(`conv-${Math.random().toString(36).slice(2, 10)}`);
    setTurns([]);
    setSourcesDrawerOpen(false);
    inputRef.current?.focus();
  }, []);

  // Get active session object
  const currentSession: ChatSession = {
    id: sessionId,
    title: sessionTitle,
    createdAt: parseInt(sessionId.split("-")[1]) || Date.now(),
    updatedAt: Date.now(),
    turns: turns
      .filter((t) => t.status === "done" && t.answer)
      .map((t): StoredTurn => ({
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

  // Last turn evidence for the sources drawer
  const lastDoneTurn = [...turns].reverse().find(
    (t) => t.status === "done" && t.answer && !t.answer.abstained
  );
  const activeEvidence = lastDoneTurn?.evidence ?? [];

  // Share action
  const handleShare = async () => {
    const ok = await copyShareLink(currentSession);
    if (ok) {
      showToast("Link copied to clipboard! Anyone with access can view this session.");
    } else {
      showToast("Failed to copy link.");
    }
  };

  // Rename action
  const openRenameModal = () => {
    setRenameInputValue(sessionTitle);
    setIsRenameOpen(true);
    setOptionsMenuOpen(false);
  };

  const handleSaveRename = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = renameInputValue.trim();
    if (trimmed) {
      renameSession(sessionId, trimmed);
      setSessionTitle(trimmed);
      setSessionRefresh((n) => n + 1);
      showToast("Session renamed successfully.");
    }
    setIsRenameOpen(false);
  };

  // Pin action
  const handleTogglePin = () => {
    const isPinned = togglePinSession(sessionId);
    setSessionRefresh((n) => n + 1);
    showToast(isPinned ? "Chat session pinned to top." : "Chat session unpinned.");
    setOptionsMenuOpen(false);
  };

  // Delete action
  const handleDeleteCurrentSession = () => {
    deleteSession(sessionId);
    setSessionRefresh((n) => n + 1);
    handleNewChat();
    showToast("Chat session deleted.");
    setOptionsMenuOpen(false);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0A0D14]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-primary/95 px-4 py-2 text-xs font-semibold text-bg shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200">
          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Rename Modal */}
      {isRenameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1.5">Rename Session</h3>
            <p className="text-xs text-zinc-400 mb-4">
              Give this chat session a memorable, custom name.
            </p>
            <form onSubmit={handleSaveRename}>
              <input
                type="text"
                autoFocus
                value={renameInputValue}
                onChange={(e) => setRenameInputValue(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/40 px-3.5 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-primary focus:outline-none mb-5"
                placeholder="Enter session title..."
              />
              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsRenameOpen(false)}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-bg hover:bg-primary-hover transition-colors"
                >
                  Save Title
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Document Viewer Modal */}
      {activeViewerDoc && (
        <DocumentViewerModal
          documentId={activeViewerDoc.documentId}
          initialPage={activeViewerDoc.page}
          highlightSnippet={activeViewerDoc.snippet}
          onClose={() => setActiveViewerDoc(null)}
        />
      )}

      {/* Sessions Sidebar */}
      <CopilotSessions
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        refreshTrigger={sessionRefresh}
      />

      {/* Main Chat Workspace (Spacious & Clean) */}
      <div className="flex flex-1 flex-col min-w-0 bg-[#0A0D14] relative">
        {/* Top Perplexity Action Bar */}
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0C101A]/80 backdrop-blur-md px-6 py-2.5 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="truncate text-sm font-semibold text-white tracking-tight">
              {sessionTitle}
            </h1>
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-mono text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Grounded AI
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Incognito Quick Toggle: ACCESSIBLE ON COPILOT */}
            <button
              onClick={toggleIncognito}
              title={isIncognito ? "Incognito Active · Click to exit" : "Switch to Incognito Session"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-all cursor-pointer border",
                isIncognito
                  ? "bg-evidence/15 text-evidence border-evidence/40 shadow-[0_0_12px_rgba(79,209,197,0.3)]"
                  : "bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] border-white/[0.06]"
              )}
            >
              <Glasses className="h-3.5 w-3.5 text-evidence" />
              <span className="font-mono text-[11px] font-medium hidden sm:inline">
                {isIncognito ? "Incognito On" : "Incognito"}
              </span>
            </button>

            {/* Sources Button */}
            {activeEvidence.length > 0 && (
              <button
                onClick={() => setSourcesDrawerOpen(!sourcesDrawerOpen)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  sourcesDrawerOpen
                    ? "bg-primary/20 text-white border border-primary/40 shadow-[0_0_12px_rgba(240,168,87,0.2)]"
                    : "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white border border-white/[0.06]"
                )}
                title="View Grounded Sources"
              >
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                <span>Sources</span>
                <span className="font-mono text-[10px] bg-white/[0.08] px-1.5 py-0.2 rounded-full">
                  {activeEvidence.length}
                </span>
              </button>
            )}

            {/* Share Button */}
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
              title="Share session link"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Share</span>
            </button>

            {/* Options Menu (...) matching Screenshot 3 */}
            <div className="relative" ref={optionsMenuRef}>
              <button
                onClick={() => setOptionsMenuOpen(!optionsMenuOpen)}
                className="rounded-lg p-1.5 text-zinc-400 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/10 transition-colors"
                title="Session options"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>

              {optionsMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-72 rounded-2xl border border-white/10 bg-[#121620]/95 backdrop-blur-xl p-2.5 shadow-2xl z-50 text-left animate-in fade-in zoom-in-95 duration-150">
                  {/* Session Header */}
                  <div className="px-3 py-2 border-b border-white/[0.06] mb-1">
                    <p className="text-xs font-semibold text-white line-clamp-2 leading-snug">
                      {sessionTitle}
                    </p>
                    <div className="mt-1.5 space-y-0.5 text-[10px] text-zinc-400">
                      <div className="flex items-center justify-between">
                        <span>Created by</span>
                        <span className="text-zinc-300 font-medium">
                          {user?.name || "varadsanto64649 (You)"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Last Updated</span>
                        <span className="text-zinc-300">
                          {new Date(currentSession.updatedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Options List */}
                  <div className="space-y-0.5 pt-1">
                    <button
                      onClick={handleTogglePin}
                      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <Pin className="h-3.5 w-3.5 text-zinc-400" />
                      <span>{getSession(sessionId)?.pinned ? "Unpin session" : "Pin session"}</span>
                    </button>

                    <button
                      onClick={() => {
                        showToast("Added to enterprise project workspace");
                        setOptionsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <FolderPlus className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Add to project</span>
                    </button>

                    <button
                      onClick={openRenameModal}
                      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Rename Session</span>
                    </button>

                    <div className="my-1.5 border-t border-white/[0.06]" />

                    <button
                      onClick={() => {
                        exportToPdf(currentSession);
                        setOptionsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <FileDown className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Export as PDF</span>
                    </button>

                    <button
                      onClick={() => {
                        exportToMarkdown(currentSession);
                        setOptionsMenuOpen(false);
                        showToast("Exported as Markdown (.md)");
                      }}
                      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Export as Markdown</span>
                    </button>

                    <button
                      onClick={() => {
                        exportToDocx(currentSession);
                        setOptionsMenuOpen(false);
                        showToast("Exported as Word document (.doc)");
                      }}
                      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Export as DOCX</span>
                    </button>

                    <div className="my-1.5 border-t border-white/[0.06]" />

                    <button
                      onClick={handleDeleteCurrentSession}
                      className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat Content Body */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Main Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
            {turns.length === 0 ? (
              <div className="flex min-h-full flex-col items-center justify-center py-6 px-4 my-auto">
                <div className="w-full max-w-xl text-center">
                  {/* Glowing Sparkles Glyph */}
                  <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 shadow-[0_0_25px_rgba(240,168,87,0.25)]">
                    {isIncognito ? (
                      <Glasses className="h-6 w-6 text-evidence" strokeWidth={1.75} />
                    ) : (
                      <Sparkles className="h-6 w-6 text-primary" strokeWidth={1.75} />
                    )}
                  </div>

                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary">
                      {isIncognito ? "INCOGNITO SESSION" : "DECISION INTELLIGENCE COPILOT"}
                    </span>
                  </div>

                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
                    {isIncognito ? "You're incognito" : "What would you like to know?"}
                  </h2>

                  <p className="text-[13px] text-zinc-400 max-w-md mx-auto leading-relaxed mb-6">
                    {isIncognito
                      ? "Sessions you create won't save to your personal history and will remain strictly ephemeral."
                      : "Ask questions across your authorized call reports. Every answer is grounded with page-level citations."}
                  </p>

                  {/* 2-Column Clean Curated Query Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                    {EXAMPLE_QUERIES.slice(0, 4).map((q) => (
                      <button
                        key={q}
                        onClick={() => runQuery(q)}
                        className="group flex flex-col justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] hover:border-primary/40 p-3 text-left transition-all duration-150 shadow-sm cursor-pointer"
                      >
                        <span className="text-[12px] font-medium text-zinc-300 group-hover:text-white leading-snug line-clamp-2">
                          {q}
                        </span>
                        <span className="mt-2 text-[10px] font-mono text-zinc-500 group-hover:text-primary transition-colors">
                          Ask this question →
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-4xl py-4 space-y-4">
                {turns.map((turn) => (
                  <TurnBubble
                    key={turn.id}
                    turn={turn}
                    onFeedback={handleFeedback}
                    onOpenSources={() => setSourcesDrawerOpen(true)}
                    onOpenDocument={handleOpenDocument}
                  />
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Collapsible Grounded Sources Side-Drawer */}
          {sourcesDrawerOpen && (
            <div className="w-80 sm:w-96 shrink-0 border-l border-white/[0.08] bg-[#0A0D15]/95 backdrop-blur-xl flex flex-col z-30 animate-in slide-in-from-right-8 duration-200">
              <div className="flex items-center justify-between border-b border-white/[0.06] p-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Grounded Sources ({activeEvidence.length})
                  </h3>
                </div>
                <button
                  onClick={() => setSourcesDrawerOpen(false)}
                  className="rounded p-1 text-zinc-400 hover:text-white hover:bg-white/[0.06]"
                  title="Close sources panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <CopilotSources
                  citations={lastDoneTurn?.answer?.citations ?? []}
                  evidence={activeEvidence}
                  traceId={lastDoneTurn?.traceId}
                  highlightedIndex={null}
                  onHoverSource={() => {}}
                  onOpenDocument={handleOpenDocument}
                />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Input Area (Cleanly Anchored at Bottom) */}
        <div className="shrink-0 border-t border-white/[0.08] bg-[#0A0D15]/95 backdrop-blur-xl px-4 md:px-8 pt-3.5 pb-5">
          <div className="mx-auto max-w-4xl">
            {/* Incognito Notice */}
            {isIncognito && (
              <div className="mb-2.5 flex items-center justify-between text-[11px] px-1 text-evidence">
                <div className="flex items-center gap-1.5 font-medium">
                  <Glasses className="h-3.5 w-3.5 animate-pulse" />
                  <span>Incognito session active — queries are strictly ephemeral.</span>
                </div>
                <button
                  onClick={toggleIncognito}
                  className="text-evidence hover:underline cursor-pointer font-medium"
                >
                  Exit incognito
                </button>
              </div>
            )}

            {/* Input Box */}
            <div className="relative flex items-center rounded-2xl border border-white/[0.12] bg-[#121620] px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.6)] focus-within:border-primary/60 focus-within:shadow-[0_0_25px_rgba(240,168,87,0.18)] transition-all">
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
                placeholder={
                  isIncognito
                    ? "Ask incognito query (ephemeral)..."
                    : "Ask about call reports, customer metrics, covenants..."
                }
                className="w-full bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none"
              />

              <button
                onClick={() => runQuery(input)}
                disabled={busy || !input.trim()}
                aria-label={busy ? "Sending" : "Send"}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all ml-2",
                  input.trim()
                    ? "bg-primary text-bg font-bold shadow-[0_0_15px_rgba(240,168,87,0.4)] hover:scale-105 active:scale-95 cursor-pointer"
                    : "bg-white/5 text-zinc-600 cursor-not-allowed"
                )}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Send className="h-4 w-4" strokeWidth={2} />
                )}
              </button>
            </div>

            <p className="mt-2 text-center text-[10.5px] text-zinc-500 font-mono">
              Answers are grounded in authorized call reports with page-level citations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
