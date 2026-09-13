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
  } catch {
    // localStorage full or unavailable
  }
}

export function getAllSessions(): ChatSession[] {
  return readSessions().sort((a, b) => b.updatedAt - a.updatedAt);
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

export function deleteSession(sessionId: string): void {
  const sessions = readSessions().filter((s) => s.id !== sessionId);
  writeSessions(sessions);
}

export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSessionTitle(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 57) + "…";
}

export function groupSessionsByDate(sessions: ChatSession[]): {
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
    today: [] as ChatSession[],
    yesterday: [] as ChatSession[],
    previous7: [] as ChatSession[],
    older: [] as ChatSession[],
  };

  for (const s of sessions) {
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
