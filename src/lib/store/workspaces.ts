"use client";

import { toast } from "sonner";
import { create } from "zustand";
import type { DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import type { ChangePlan } from "@/lib/engine/changes";
import { computeAll } from "@/lib/engine/compute";
import { markFresh } from "@/lib/motion/fresh";
import { applyPlan, undoPlan } from "./apply-plan";
import {
  blueprintOf,
  type ChangeEntry,
  type Invite,
  type Member,
  type NewWorkspace,
  newWorkspaceId,
  randomToken,
  type SetupProgress,
  type Workspace,
  workspaceFrom,
} from "./workspace-model";

export * from "./workspace-model";

type State = {
  /** Every workspace the signed-in account can open, keyed by id. */
  workspaces: Record<string, Workspace>;
  /** undefined until loaded from the server; null when signed out. */
  owner: string | null | undefined;
  /** "error" when the last load failed; the shell offers a retry. */
  status: "idle" | "loading" | "ready" | "error";
  load: (owner: string | null) => Promise<void>;
  renameWorkspace: (slug: string, name: string) => void;
  deleteWorkspace: (slug: string) => void;
  /** Clears local state after the account is deleted (the server removes its data). */
  dropOwner: (owner: string) => void;
  inviteMember: (slug: string, email: string, role: Member["role"], invitedBy: string) => Invite | null;
  revokeInvite: (slug: string, token: string) => void;
  setMemberRole: (slug: string, accountId: string, role: Member["role"]) => void;
  removeMember: (slug: string, accountId: string) => void;
  leaveWorkspace: (slug: string) => void;
  open: (slug: string) => void;
  createWorkspace: (input: NewWorkspace) => string;
  setRecords: (slug: string, records: DataRecord[]) => void;
  setDoc: (slug: string, viewId: string, body: string) => void;
  /** Pulls in records the server created since this copy was read (public bookings), without saving. */
  refresh: (slug: string) => Promise<void>;
  saveSetup: (slug: string, progress: SetupProgress) => void;
  finishSetup: (slug: string, data: WorkspaceData, name: string, summary: string) => void;
  /** by: who made it, for invites the plan sends. */
  applyChange: (slug: string, plan: ChangePlan, by?: string) => ChangeEntry | null;
  undoChange: (slug: string, changeId: string) => void;
};

/* ---------- Server sync ---------- */

const SAVE_DELAY_MS = 500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Set<string>();
let warned = false;

async function send(slug: string, attempt = 0): Promise<void> {
  const ws = useWorkspaces.getState().workspaces[slug];
  if (!ws) return;
  try {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ws),
    });
    if (res.ok) {
      pending.delete(slug);
      warned = false;
      return;
    }
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    if (res.status >= 500 && attempt < 2)
      return void setTimeout(() => void send(slug, attempt + 1), 2000 * (attempt + 1));
    pending.delete(slug);
    toast.error("Couldn't save your change", {
      description: body?.message ?? "Reload the page and try again.",
    });
  } catch {
    if (attempt < 3) return void setTimeout(() => void send(slug, attempt + 1), 2000 * (attempt + 1));
    if (!warned)
      toast.error("You're offline", { description: "Changes will save when the connection is back." });
    warned = true;
  }
}

function scheduleSave(slug: string) {
  pending.add(slug);
  clearTimeout(timers.get(slug));
  timers.set(
    slug,
    setTimeout(() => {
      timers.delete(slug);
      void send(slug);
    }, SAVE_DELAY_MS),
  );
}

async function sendDelete(slug: string) {
  clearTimeout(timers.get(slug));
  pending.delete(slug);
  const res = await fetch(`/api/workspaces/${encodeURIComponent(slug)}`, { method: "DELETE" }).catch(
    () => null,
  );
  if (!res?.ok)
    toast.error("Couldn't remove the workspace", { description: "Reload the page and try again." });
}

/** True while edits are waiting to reach the server. */
export const hasUnsavedChanges = () => pending.size > 0;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (pending.size) event.preventDefault();
  });
}

/* ---------- Store ---------- */

export const useWorkspaces = create<State>()((rawSet, get) => {
  /** Applies a change to the workspace map and saves every workspace whose object changed. */
  const set = (partial: Partial<State> | ((s: State) => Partial<State> | State)) =>
    rawSet((state) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      if (next.workspaces && next.workspaces !== state.workspaces && state.owner) {
        for (const [slug, ws] of Object.entries(next.workspaces))
          if (state.workspaces[slug] !== ws) scheduleSave(slug);
      }
      return next;
    });
  const update = (slug: string, fn: (ws: Workspace) => Workspace) =>
    set((s) => {
      const ws = s.workspaces[slug];
      return ws ? { workspaces: { ...s.workspaces, [slug]: fn(ws) } } : s;
    });

  return {
    workspaces: {},
    owner: undefined,
    status: "idle",

    load: async (owner) => {
      if (!owner) return rawSet({ owner: null, workspaces: {}, status: "idle" });
      if (get().owner === owner && get().status === "ready") return;
      rawSet({ status: "loading" });
      try {
        const res = await fetch("/api/workspaces", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { workspaces: Workspace[] };
        // A workspace created while the list was loading (typing on the home page right after signing up)
        // isn't on the server yet: keep it and save it now instead of dropping it.
        const server = Object.fromEntries(body.workspaces.map((w) => [w.slug, w]));
        const early = Object.values(get().workspaces).filter((w) => !server[w.slug]);
        rawSet({
          owner,
          status: "ready",
          workspaces: {
            ...server,
            ...Object.fromEntries(early.map((w) => [w.slug, { ...w, ownerId: owner }])),
          },
        });
        for (const w of early) scheduleSave(w.slug);
      } catch {
        rawSet({ owner, status: "error", workspaces: {} });
      }
    },

    renameWorkspace: (slug, name) => {
      const ws = get().workspaces[slug];
      const clean = name.trim();
      if (!ws || !clean || clean === ws.name) return;
      // A rename is a change like any other: versioned, in History, and undoable.
      get().applyChange(slug, {
        request: `Rename the workspace to ${clean}`,
        title: "Rename workspace",
        facts: [],
        steps: [{ kind: "change", label: "Workspace name", detail: `${ws.name} → ${clean}` }],
        ops: [{ op: "rename_workspace", name: clean }],
      });
    },

    deleteWorkspace: (slug) => {
      rawSet((s) => {
        const { [slug]: _removed, ...rest } = s.workspaces;
        return { workspaces: rest };
      });
      void sendDelete(slug);
    },

    leaveWorkspace: (slug) => get().deleteWorkspace(slug),

    dropOwner: () => rawSet({ owner: null, workspaces: {}, status: "idle" }),

    inviteMember: (slug, email, role, invitedBy) => {
      const clean = email.trim().toLowerCase();
      if (!get().workspaces[slug] || !clean) return null;
      const invite: Invite = {
        token: randomToken(),
        email: clean,
        role,
        invitedAt: new Date().toISOString(),
        invitedBy,
      };
      update(slug, (ws) => ({
        ...ws,
        invites: [...(ws.invites ?? []).filter((i) => i.email !== clean), invite],
      }));
      return invite;
    },

    revokeInvite: (slug, token) =>
      update(slug, (ws) => ({ ...ws, invites: ws.invites?.filter((i) => i.token !== token) })),

    setMemberRole: (slug, accountId, role) =>
      update(slug, (ws) => ({
        ...ws,
        members: ws.members?.map((m) => (m.accountId === accountId ? { ...m, role } : m)),
      })),

    removeMember: (slug, accountId) =>
      update(slug, (ws) => ({ ...ws, members: ws.members?.filter((m) => m.accountId !== accountId) })),

    open: (slug) => {
      // Opening isn't an edit: keep it local so viewers and staff don't send saves.
      rawSet((s) => {
        const ws = s.workspaces[slug];
        return ws
          ? { workspaces: { ...s.workspaces, [slug]: { ...ws, openedAt: new Date().toISOString() } } }
          : s;
      });
    },

    createWorkspace: (input) => {
      const slug = input.slug ?? newWorkspaceId(input.name);
      const ws = {
        ...workspaceFrom(input, slug, new Date().toISOString()),
        ownerId: get().owner ?? undefined,
        members: [],
        invites: [],
      };
      set((s) => ({ workspaces: { ...s.workspaces, [slug]: ws } }));
      return slug;
    },

    setRecords: (slug, records) => update(slug, (ws) => ({ ...ws, records })),

    refresh: async (slug) => {
      if (pending.has(slug) || !get().workspaces[slug]) return;
      const res = await fetch(`/api/workspaces/${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(
        () => null,
      );
      if (!res?.ok) return;
      const body = (await res.json().catch(() => null)) as {
        records: DataRecord[];
        syncedAt: string;
      } | null;
      if (!body || pending.has(slug)) return;
      rawSet((s) => {
        const ws = s.workspaces[slug];
        if (!ws) return s;
        const have = new Set(ws.records.map((r) => r.id));
        const since = ws.syncedAt ?? "";
        const added = body.records.filter((r) => !have.has(r.id) && r.createdAt > since);
        if (added.length) markFresh(added.map((r) => r.id));
        return {
          workspaces: {
            ...s.workspaces,
            [slug]: {
              ...ws,
              syncedAt: body.syncedAt,
              records: added.length ? computeAll(blueprintOf(ws), [...ws.records, ...added]) : ws.records,
            },
          },
        };
      });
    },

    setDoc: (slug, viewId, body) =>
      update(slug, (ws) => ({
        ...ws,
        docs: { ...ws.docs, [viewId]: { body, updatedAt: new Date().toISOString() } },
      })),

    saveSetup: (slug, progress) =>
      update(slug, (ws) => (ws.setup ? { ...ws, setup: { ...ws.setup, progress } } : ws)),

    finishSetup: (slug, data, name, summary) =>
      update(slug, (ws) => {
        const version = ws.versions.length + 1;
        return {
          ...ws,
          name,
          summary,
          versions: [...ws.versions, { ...data.blueprint, version, workspaceName: name }],
          currentVersion: version,
          records: data.records,
          setup: undefined,
        };
      }),

    applyChange: (slug, plan, by) => {
      const ws = get().workspaces[slug];
      if (!ws) return null;
      const { workspace, entry } = applyPlan(ws, plan, { by });
      update(slug, () => workspace);
      return entry;
    },

    undoChange: (slug, changeId) => update(slug, (ws) => undoPlan(ws, changeId) ?? ws),
  };
});
