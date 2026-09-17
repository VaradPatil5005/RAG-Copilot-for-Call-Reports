"use client";

/**
 * Copilot Sessions Sidebar — Perplexity-style chat history panel.
 *
 * Shows past conversations grouped by date, pinned items, and real-time chat search.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Search,
  X,
  Pin,
  Pencil,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getAllSessions,
  groupSessionsByDate,
  deleteSession,
  renameSession,
  togglePinSession,
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

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);

  useEffect(() => {
    setEditTitle(session.title);
  }, [session.title]);

  const handleSaveRename = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (editTitle.trim() && editTitle.trim() !== session.title) {
      onRename(session.id, editTitle.trim());
    }
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all",
        isActive
          ? "bg-white/[0.08] text-white font-medium"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
      )}
      onClick={() => {
        if (!isEditing) onSelect(session.id);
      }}
    >
      <div className="relative shrink-0">
        <MessageSquare
          className={cn(
            "h-3.5 w-3.5 transition-colors",
            isActive ? "text-primary" : "text-zinc-500"
          )}
          strokeWidth={1.75}
        />
        {session.pinned && (
          <Pin className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 text-primary fill-primary" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <form onSubmit={handleSaveRename} className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setIsEditing(false);
              }}
              onBlur={() => handleSaveRename()}
              className="w-full bg-black/40 border border-primary/60 rounded px-1.5 py-0.5 text-xs text-white outline-none"
            />
            <button
              type="submit"
              className="p-1 rounded bg-primary/20 text-primary hover:bg-primary/30"
              title="Save"
            >
              <Check className="h-3 w-3" />
            </button>
          </form>
        ) : (
          <>
            <p className="truncate text-[12px] font-medium leading-tight">
              {session.title}
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-500">
              {session.turns.length} {session.turns.length === 1 ? "turn" : "turns"} · {formatTime(session.updatedAt)}
            </p>
          </>
        )}
      </div>

      {!isEditing && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(session.id);
            }}
            className={cn(
              "rounded p-1 text-zinc-500 hover:text-primary transition-colors",
              session.pinned && "text-primary opacity-100"
            )}
            title={session.pinned ? "Unpin session" : "Pin session"}
          >
            <Pin className={cn("h-3 w-3", session.pinned && "fill-primary")} strokeWidth={1.75} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className="rounded p-1 text-zinc-500 hover:text-white transition-colors"
            title="Rename session"
          >
            <Pencil className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session.id);
            }}
            className="rounded p-1 text-zinc-500 hover:bg-error/15 hover:text-error transition-colors"
            title="Delete session"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
          </button>
        </div>
      )}
    </div>
  );
}

function SessionGroup({
  label,
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
}: {
  label: string;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-text-faint">
        {label}
      </p>
      <div className="space-y-0.5">
        {sessions.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === activeSessionId}
            onSelect={onSelect}
            onDelete={onDelete}
            onTogglePin={onTogglePin}
            onRename={onRename}
          />
        ))}
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
  const [searchQuery, setSearchQuery] = useState("");

  const reloadSessions = () => {
    setSessions(getAllSessions());
  };

  useEffect(() => {
    const timer = setTimeout(reloadSessions, 0);
    window.addEventListener("copilot_sessions_updated", reloadSessions);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("copilot_sessions_updated", reloadSessions);
    };
  }, [refreshTrigger]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase().trim();
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      return s.turns.some(
        (t) =>
          t.query.toLowerCase().includes(q) ||
          (t.answer?.answer && t.answer.answer.toLowerCase().includes(q))
      );
    });
  }, [sessions, searchQuery]);

  const groups = groupSessionsByDate(filteredSessions);

  const handleDelete = (id: string) => {
    deleteSession(id);
    reloadSessions();
    if (id === activeSessionId) {
      onNewChat();
    }
  };

  const handleTogglePin = (id: string) => {
    togglePinSession(id);
    reloadSessions();
  };

  const handleRename = (id: string, newTitle: string) => {
    renameSession(id, newTitle);
    reloadSessions();
  };

  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center border-r border-white/[0.06] bg-[#06080F] py-3 gap-3">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded-lg p-2 text-zinc-400 hover:bg-white/[0.05] hover:text-white transition-colors"
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={onNewChat}
          className="rounded-lg p-2 text-zinc-400 hover:bg-white/[0.05] hover:text-white transition-colors"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-[260px] shrink-0 flex-col border-r border-white/[0.06] bg-[#06080F]">
      {/* Top Header: New Chat & Collapse */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/[0.1] transition-colors"
        >
          <Plus className="h-3.5 w-3.5 text-white" strokeWidth={2} />
          New Chat
        </button>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.05] hover:text-white transition-colors"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Search Input */}
      <div className="px-2.5 pt-2 pb-1 border-b border-white/[0.04]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search previous chats..."
            className="w-full rounded-lg bg-white/[0.04] border border-white/[0.06] pl-8 pr-7 py-1.5 text-[11.5px] text-white placeholder:text-zinc-500 focus:border-primary/50 focus:bg-white/[0.07] outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-0.5"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-3 px-1.5">
        {filteredSessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <MessageSquare className="mx-auto h-6 w-6 text-text-faint" strokeWidth={1.25} />
            <p className="mt-2 text-[11px] text-text-faint">
              {searchQuery ? "No matching chats found" : "Your chat history will appear here"}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="mt-2 text-[10px] text-primary hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <>
            {groups.pinned.length > 0 && (
              <SessionGroup
                label="Pinned"
                sessions={groups.pinned}
                activeSessionId={activeSessionId}
                onSelect={onSelectSession}
                onDelete={handleDelete}
                onTogglePin={handleTogglePin}
                onRename={handleRename}
              />
            )}
            <SessionGroup
              label="Today"
              sessions={groups.today}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              onRename={handleRename}
            />
            <SessionGroup
              label="Yesterday"
              sessions={groups.yesterday}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              onRename={handleRename}
            />
            <SessionGroup
              label="Previous 7 Days"
              sessions={groups.previous7}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              onRename={handleRename}
            />
            <SessionGroup
              label="Older"
              sessions={groups.older}
              activeSessionId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              onRename={handleRename}
            />
          </>
        )}
      </div>
    </div>
  );
}
