"use client";

/**
 * Copilot session persistence — localStorage-backed chat history.
 *
 * Stores up to MAX_SESSIONS recent chat sessions so users can revisit
 * past conversations. Each session captures the query/answer turns
 * with their citations and evidence for full offline replay.
 */

import type { ChatAnswer, ChatEvidenceItem, CitationValidationSummary } from "@/lib/api";

const STORAGE_KEY = "copilot_sessions";
const MAX_SESSIONS = 50;

export interface StoredTurn {
  id: string;
  query: string;
  answer: ChatAnswer | null;
  evidence: ChatEvidenceItem[];
  citationValidation: CitationValidationSummary | null;
  modelName: string | null;
  providerIsFallback: boolean;
  latencyMs: number | null;
  traceId?: string;
  feedbackRating?: 1 | -1;
  feedbackSubmitted?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: StoredTurn[];
  pinned?: boolean;
  customTitle?: boolean;
}

function readSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

function writeSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new Event("copilot_sessions_updated"));
  } catch {
    // localStorage full or unavailable
  }
}

export function getAllSessions(): ChatSession[] {
  return readSessions().sort((a, b) => {
    // Sort pinned to the top, then by updatedAt descending
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function getSession(sessionId: string): ChatSession | null {
  return readSessions().find((s) => s.id === sessionId) ?? null;
}

export function saveSession(session: ChatSession): void {
  const sessions = readSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  writeSessions(sessions);
}

export function renameSession(sessionId: string, newTitle: string): void {
  const trimmed = newTitle.trim();
  if (!trimmed) return;
  const sessions = readSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (session) {
    session.title = trimmed;
    session.customTitle = true;
    session.updatedAt = Date.now();
    writeSessions(sessions);
  }
}

export function togglePinSession(sessionId: string): boolean {
  const sessions = readSessions();
  const session = sessions.find((s) => s.id === sessionId);
  let isPinned = false;
  if (session) {
    session.pinned = !session.pinned;
    isPinned = !!session.pinned;
    writeSessions(sessions);
  }
  return isPinned;
}

export function deleteSession(sessionId: string): void {
  const sessions = readSessions().filter((s) => s.id !== sessionId);
  writeSessions(sessions);
}

export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generates a clean, unique, Perplexity-style topic title from a prompt.
 * Strips conversational fluff (e.g., "What is the overall status of...")
 * and extracts the core entity/topic (e.g. "Apex Supplier Quality Status").
 */
export function generateSessionTitle(query: string): string {
  let cleaned = query.trim();
  // Strip conversational filler prefixes
  cleaned = cleaned.replace(
    /^(can you (please )?|please |could you |would you |tell me (about )?|what (is|are|were|was) (the )?|how (to|do|does|can) |why (is|are|does) |give me (a |an )?|summarize (the )?|list (all )?|explain (the )?|find (all )?|what (risks|actions|status) (were|are|is) )/i,
    ""
  );
  // Remove trailing punctuation marks
  cleaned = cleaned.replace(/[?!.]+$/, "").trim();
  if (!cleaned) cleaned = query.trim();

  // Capitalize first character
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 48).trim() + "…";
}

export function groupSessionsByDate(sessions: ChatSession[]): {
  pinned: ChatSession[];
  today: ChatSession[];
  yesterday: ChatSession[];
  previous7: ChatSession[];
  older: ChatSession[];
} {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOf7DaysAgo = startOfToday - 7 * 86_400_000;

  const groups = {
    pinned: [] as ChatSession[],
    today: [] as ChatSession[],
    yesterday: [] as ChatSession[],
    previous7: [] as ChatSession[],
    older: [] as ChatSession[],
  };

  for (const s of sessions) {
    if (s.pinned) {
      groups.pinned.push(s);
      continue;
    }
    if (s.updatedAt >= startOfToday) {
      groups.today.push(s);
    } else if (s.updatedAt >= startOfYesterday) {
      groups.yesterday.push(s);
    } else if (s.updatedAt >= startOf7DaysAgo) {
      groups.previous7.push(s);
    } else {
      groups.older.push(s);
    }
  }

  return groups;
}
