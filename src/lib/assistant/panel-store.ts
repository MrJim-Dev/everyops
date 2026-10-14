"use client";

import { create } from "zustand";
import type { AttachmentRef } from "@/lib/assistant/attachments";
import type { Navigation } from "@/lib/assistant/screen";
import type { ChangePlan } from "@/lib/engine/changes";

export type AssistantTurn = {
  role: "user" | "assistant";
  text: string;
  attachments?: AttachmentRef[];
  suggestions?: string[];
  plan?: ChangePlan;
  /** What happened to the plan: still waiting, applied (with its history entry), dismissed or undone. */
  planState?: "pending" | "applied" | "dismissed" | "undone";
  changeId?: string;
  /** A page or record the reply points to; followed straight away when open is true. */
  navigate?: Navigation;
  /** The records and pages the reply is based on, as links. */
  sources?: Navigation[];
  /** What the assistant did while working on this reply, in order, and how long it took. */
  activity?: string[];
  durationMs?: number;
  error?: boolean;
  /** The person stopped this request before an answer came back. */
  stopped?: boolean;
  /** The website section this message was about, e.g. "Hero". */
  ref?: string;
};

/** A request on its way: when it started, what it's doing, and the steps reported so far. */
export type Pending = { startedAt: number; phase: "saving" | "asking"; steps: string[] };

export type ThreadSummary = { id: string; title: string; updatedAt: string; turns: number };

type State = {
  open: boolean;
  /** Opened or closed from the keyboard (⌘J): switch without animating. */
  instant: boolean;
  setOpen: (open: boolean) => void;
  toggle: (instant?: boolean) => void;
  /** Requests in flight per workspace, shared by the panel and the Ask EveryOps page. */
  pending: Record<string, Pending | undefined>;
  setPending: (workspaceId: string, pending: Pending | undefined) => void;
  /** Drops every turn from `length` on, so a failed or stopped request can be sent again. */
  truncate: (workspaceId: string, length: number) => void;
  /** The conversation open in each workspace. */
  active: Record<string, string>;
  /** Turns by thread id. */
  threads: Record<string, AssistantTurn[]>;
  /** Each workspace's saved conversations, newest first. */
  lists: Record<string, ThreadSummary[]>;
  /** The panel shows the list of past conversations instead of the chat. */
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  push: (workspaceId: string, turn: AssistantTurn) => void;
  patch: (workspaceId: string, index: number, patch: Partial<AssistantTurn>) => void;
  /** Starts a fresh conversation; the current one stays in the history. */
  start: (workspaceId: string) => void;
  openThread: (workspaceId: string, threadId: string) => Promise<boolean>;
  loadList: (workspaceId: string) => Promise<void>;
};

const newThreadId = () => `thread_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A conversation is named by its first question. */
export function threadTitle(turns: AssistantTurn[]) {
  const first = turns.find((t) => t.role === "user")?.text.trim() || "Files";
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Saves a conversation shortly after it changes, so a burst of updates is one request. */
function scheduleSave(workspaceId: string, threadId: string) {
  clearTimeout(timers.get(threadId));
  timers.set(
    threadId,
    setTimeout(() => {
      timers.delete(threadId);
      const turns = useAssistant.getState().threads[threadId] ?? [];
      if (!turns.length) return;
      void fetch(`/api/ai/threads/${threadId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, title: threadTitle(turns), turns: turns.slice(-200) }),
      }).catch(() => {});
    }, 700),
  );
}

/** The workspace assistant panel: whether it's open, its conversations and which one is showing. */
export const useAssistant = create<State>()((set, get) => {
  /** The thread a workspace is on, created the first time something is said. */
  const activeId = (workspaceId: string) => {
    const id = get().active[workspaceId];
    if (id) return id;
    const fresh = newThreadId();
    set((s) => ({ active: { ...s.active, [workspaceId]: fresh } }));
    return fresh;
  };
  const touch = (workspaceId: string, threadId: string) => {
    const turns = get().threads[threadId] ?? [];
    const summary: ThreadSummary = {
      id: threadId,
      title: threadTitle(turns),
      updatedAt: new Date().toISOString(),
      turns: turns.length,
    };
    set((s) => ({
      lists: {
        ...s.lists,
        [workspaceId]: [summary, ...(s.lists[workspaceId] ?? []).filter((t) => t.id !== threadId)],
      },
    }));
    scheduleSave(workspaceId, threadId);
  };

  return {
    open: false,
    instant: false,
    setOpen: (open) => set({ open, instant: false }),
    toggle: (instant = false) => set((s) => ({ open: !s.open, instant })),
    pending: {},
    setPending: (workspaceId, pending) => set((s) => ({ pending: { ...s.pending, [workspaceId]: pending } })),
    truncate: (workspaceId, length) => {
      const id = get().active[workspaceId];
      if (!id) return;
      set((s) => ({ threads: { ...s.threads, [id]: (s.threads[id] ?? []).slice(0, length) } }));
      touch(workspaceId, id);
    },
    active: {},
    threads: {},
    lists: {},
    showHistory: false,
    setShowHistory: (showHistory) => set({ showHistory }),
    push: (workspaceId, turn) => {
      const id = activeId(workspaceId);
      set((s) => ({ threads: { ...s.threads, [id]: [...(s.threads[id] ?? []), turn] } }));
      touch(workspaceId, id);
    },
    patch: (workspaceId, index, patch) => {
      const id = get().active[workspaceId];
      if (!id) return;
      set((s) => ({
        threads: {
          ...s.threads,
          [id]: (s.threads[id] ?? []).map((t, i) => (i === index ? { ...t, ...patch } : t)),
        },
      }));
      touch(workspaceId, id);
    },
    start: (workspaceId) =>
      set((s) => ({ active: { ...s.active, [workspaceId]: newThreadId() }, showHistory: false })),
    openThread: async (workspaceId, threadId) => {
      if (!get().threads[threadId]) {
        const res = await fetch(`/api/ai/threads/${threadId}`).catch(() => null);
        const body = (await res?.json().catch(() => null)) as {
          ok: boolean;
          thread?: { turns: AssistantTurn[] };
        } | null;
        if (!body?.ok || !body.thread) return false;
        const turns = body.thread.turns;
        set((s) => ({ threads: { ...s.threads, [threadId]: turns } }));
      }
      set((s) => ({ active: { ...s.active, [workspaceId]: threadId }, showHistory: false }));
      return true;
    },
    loadList: async (workspaceId) => {
      const res = await fetch(`/api/ai/threads?workspaceId=${encodeURIComponent(workspaceId)}`).catch(
        () => null,
      );
      const body = (await res?.json().catch(() => null)) as { ok: boolean; threads?: ThreadSummary[] } | null;
      if (body?.ok && body.threads) {
        const saved = body.threads;
        // Conversations started in this session that haven't reached the server yet stay on top.
        set((s) => {
          const local = (s.lists[workspaceId] ?? []).filter((t) => !saved.some((x) => x.id === t.id));
          return { lists: { ...s.lists, [workspaceId]: [...local, ...saved] } };
        });
      }
    },
  };
});
