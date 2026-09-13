"use client";

/**
 * Copilot Sessions Sidebar — Perplexity-style chat history panel.
 *
 * Shows past conversations grouped by date. Clicking loads a session,
 * "New Chat" starts a fresh one. Collapsible on smaller viewports.
 */

import { useEffect, useState } from "react";
import { Plus, MessageSquare, Trash2, PanelLeftClose, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAllSessions,
  groupSessionsByDate,
  deleteSession,
  type ChatSession,
} from "./copilot-store";

interface CopilotSessionsProps {
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  refreshTrigger: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;

  if (diff < 3600_000) {
    const mins = Math.floor(diff / 60_000);
    return mins <= 1 ? "Just now" : `${mins}m ago`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours}h ago`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SessionGroup({
  label,
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
}: {
  label: string;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-text-faint">
        {label}
      </p>
      <div className="space-y-0.5">
        {sessions.map((s) => {
          const isActive = s.id === activeSessionId;
          return (
            <div
              key={s.id}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-all duration-150",
                isActive
                  ? "bg-elevated text-text"
                  : "text-text-muted hover:bg-elevated/50 hover:text-text"
              )}
              onClick={() => onSelect(s.id)}
            >
              <MessageSquare
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-colors",
                  isActive ? "text-evidence" : "text-text-faint"
                )}
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium leading-tight">
                  {s.title}
                </p>
                <p className="mt-0.5 text-[10px] text-text-faint">
                  {s.turns.length} {s.turns.length === 1 ? "message" : "messages"} · {formatTime(s.updatedAt)}
                </p>
              </div>

              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-evidence" />
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                className="shrink-0 rounded p-1 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-error/15 hover:text-error transition-all"
                aria-label="Delete session"
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CopilotSessions({
  activeSessionId,
  onSelectSession,
  onNewChat,
  refreshTrigger,
}: CopilotSessionsProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSessions(getAllSessions());
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshTrigger]);

  const groups = groupSessionsByDate(sessions);

  const handleDelete = (id: string) => {
    deleteSession(id);
    setSessions(getAllSessions());
    if (id === activeSessionId) {
      onNewChat();
    }
  };

  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center border-r border-border-subtle bg-surface/40 py-3 gap-3">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded-lg p-2 text-text-faint hover:bg-elevated hover:text-text-muted transition-colors"
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={onNewChat}
          className="rounded-lg p-2 text-text-faint hover:bg-primary/15 hover:text-primary transition-colors"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-[260px] shrink-0 flex-col border-r border-border-subtle bg-surface/40">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-3">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 rounded-lg bg-elevated/70 px-3 py-2 text-[12px] font-medium text-text hover:bg-elevated transition-colors"
        >
          <Plus className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          New Chat
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-lg p-1.5 text-text-faint hover:bg-elevated hover:text-text-muted transition-colors"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-3 px-1.5">
        {sessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="mx-auto h-6 w-6 text-text-faint" strokeWidth={1.25} />
            <p className="mt-2 text-[11px] text-text-faint">
              Your chat history will appear here
            </p>
          </div>
        ) : (
          <>
            <SessionGroup
              label="Today"
              sessions={groups.today}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
            />
            <SessionGroup
              label="Yesterday"
              sessions={groups.yesterday}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
            />
            <SessionGroup
              label="Previous 7 Days"
              sessions={groups.previous7}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
            />
            <SessionGroup
              label="Older"
              sessions={groups.older}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
            />
          </>
        )}
      </div>
    </div>
  );
}
