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
  error?: boolean;
};

type State = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Conversations per workspace for this browser session. */
  threads: Record<string, AssistantTurn[]>;
  push: (workspaceId: string, turn: AssistantTurn) => void;
  patch: (workspaceId: string, index: number, patch: Partial<AssistantTurn>) => void;
  clear: (workspaceId: string) => void;
};

/** The workspace assistant panel: whether it's open, and each workspace's conversation. */
export const useAssistant = create<State>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  threads: {},
  push: (id, turn) => set((s) => ({ threads: { ...s.threads, [id]: [...(s.threads[id] ?? []), turn] } })),
  patch: (id, index, patch) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [id]: (s.threads[id] ?? []).map((t, i) => (i === index ? { ...t, ...patch } : t)),
      },
    })),
  clear: (id) => set((s) => ({ threads: { ...s.threads, [id]: [] } })),
}));
