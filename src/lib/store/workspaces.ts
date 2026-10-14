"use client";

import { toast } from "sonner";
import { create } from "zustand";
import type { DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import type { ChangePlan } from "@/lib/engine/changes";
import { computeAll } from "@/lib/engine/compute";
import { markFresh } from "@/lib/motion/fresh";
import { applyPlan, redoPlan, undoPlan } from "./apply-plan";
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
import {
  afterSave,
  type Baseline,
  baselineOf,
  diffWorkspace,
  type PatchResult,
  pullInto,
  type RecordChanges,
  type WorkspacePatch,
} from "./workspace-sync";

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
  /** Pulls in records others saved since this copy was read (public bookings, teammates). */
  refresh: (slug: string) => Promise<void>;
  /** Loads a workspace's records and history when it opens (the list only has summaries). False if it failed. */
  ensureLoaded: (slug: string) => Promise<boolean>;
  saveSetup: (slug: string, progress: SetupProgress) => void;
  finishSetup: (slug: string, data: WorkspaceData, name: string, summary: string) => void;
  /** by: who made it, for invites the plan sends. */
  applyChange: (slug: string, plan: ChangePlan, by?: string) => ChangeEntry | null;
  undoChange: (slug: string, changeId: string) => void;
  /** Puts back the latest undone design change. */
  redoChange: (slug: string, changeId: string) => void;
};

/* ---------- Server sync ---------- */

// Saves are patches against what the server last confirmed (workspace-sync.ts): one edited record sends one record.
const SAVE_DELAY_MS = 500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Set<string>();
const inflight = new Set<string>();
const baselines = new Map<string, Baseline>();
const loads = new Map<string, Promise<boolean>>();
let warned = false;

const url = (slug: string, rest = "") => `/api/workspaces/${encodeURIComponent(slug)}${rest}`;

async function send(slug: string, attempt = 0): Promise<void> {
  if (inflight.has(slug)) return; // The save in flight checks for more changes when it's done.
  const ws = useWorkspaces.getState().workspaces[slug];
  if (!ws) return void pending.delete(slug);
  const base = baselines.get(slug);
  const patch = diffWorkspace(base, ws);
  if (!patch) return void pending.delete(slug);
  inflight.add(slug);
  let retry: (() => void) | null = null;
  try {
    const res = await fetch(url(slug), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = (await res.json().catch(() => null)) as PatchResult | null;
    if (res.ok && body?.ok) {
      const updated = body.updated ?? [];
      baselines.set(
        slug,
        afterSave(base, updated.length ? withServerCopies(patch, updated) : patch, body.revs),
      );
      if (updated.length) takeServerChanges(slug, patch, updated);
      warned = false;
      // Edits made while this save was in flight go out next.
      retry = () => void send(slug);
      return;
    }
    const failed = body && !body.ok ? body : null;
    if (res.status === 409 && failed?.conflicts && attempt < 3) {
      // Someone saved some of these records first: fold their copies in, then save the merged result.
      inflight.delete(slug);
      await pull(slug, true);
      retry = () => void send(slug, attempt + 1);
      return;
    }
    if (res.status === 409 && failed?.reload) {
      pending.delete(slug);
      toast.error("This workspace changed elsewhere", { description: failed.message });
      inflight.delete(slug);
      await ensureLoaded(slug, true);
      return;
    }
    if (res.status >= 500 && attempt < 2) {
      retry = () => void setTimeout(() => void send(slug, attempt + 1), 2000 * (attempt + 1));
      return;
    }
    pending.delete(slug);
    toast.error("Couldn't save your change", {
      description: failed?.message ?? "Reload the page and try again.",
    });
  } catch {
    if (attempt < 3) retry = () => void setTimeout(() => void send(slug, attempt + 1), 2000 * (attempt + 1));
    else {
      if (!warned)
        toast.error("You're offline", { description: "Changes will save when the connection is back." });
      warned = true;
    }
  } finally {
    inflight.delete(slug);
    if (retry) retry();
  }
}

/** The patch as the server saved it: records it changed on the way in replace the ones this browser sent. */
function withServerCopies(patch: WorkspacePatch, updated: DataRecord[]): WorkspacePatch {
  const byId = new Map(updated.map((r) => [r.id, r]));
  if (!patch.records) return patch;
  return {
    ...patch,
    records: {
      ...patch.records,
      put: patch.records.put.map((p) => ({ ...p, record: byId.get(p.record.id) ?? p.record })),
    },
  };
}

/**
 * The server renumbered new records (another device took the same order number a moment before). Their new values
 * go into this browser's copies, keeping any edits made since, and the person is told the number that was saved.
 */
function takeServerChanges(slug: string, patch: WorkspacePatch, updated: DataRecord[]) {
  const sent = new Map((patch.records?.put ?? []).map((p) => [p.record.id, p.record]));
  const notes: string[] = [];
  useWorkspaces.setState((s) => {
    const ws = s.workspaces[slug];
    if (!ws) return s;
    const byId = new Map(updated.map((r) => [r.id, r]));
    const records = ws.records.map((r) => {
      const server = byId.get(r.id);
      const mine = sent.get(r.id);
      if (!server || !mine) return r;
      const data = { ...r.data };
      for (const [key, value] of Object.entries(server.data))
        if (value !== mine.data[key]) {
          data[key] = value;
          notes.push(`${String(mine.data[key] ?? "")} → ${String(value)}`);
        }
      return { ...r, data };
    });
    return { workspaces: { ...s.workspaces, [slug]: { ...ws, records } } };
  });
  for (const n of notes) {
    const [before, after] = n.split(" → ");
    toast.info(`Saved as ${after}`, { description: `${before} was taken on another device a moment ago.` });
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

/**
 * Loads a workspace's records, history, page text and every version (the list only has summaries). Returns false
 * if it couldn't. Force reloads it even when loaded, dropping unsaved edits (the design changed elsewhere).
 */
function ensureLoaded(slug: string, force = false): Promise<boolean> {
  const ws = useWorkspaces.getState().workspaces[slug];
  if (!ws) return Promise.resolve(false);
  if (ws.loaded !== false && !force) return Promise.resolve(true);
  const running = loads.get(slug);
  if (running) return running;
  const load = (async () => {
    const res = await fetch(url(slug), { cache: "no-store" }).catch(() => null);
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as {
          workspace: Workspace;
          revs: Record<string, number>;
        } | null)
      : null;
    if (!body) return false;
    baselines.set(slug, baselineOf(body.workspace, body.revs));
    useWorkspaces.setState((s) => {
      const local = s.workspaces[slug];
      if (!local) return s;
      // Opening it just now is newer than the stored time; it's saved with the next change.
      const openedAt = local.openedAt > body.workspace.openedAt ? local.openedAt : body.workspace.openedAt;
      return { workspaces: { ...s.workspaces, [slug]: { ...body.workspace, openedAt, loaded: true } } };
    });
    return true;
  })().finally(() => loads.delete(slug));
  loads.set(slug, load);
  return load;
}

/**
 * Brings in records others saved since this copy was read (public bookings, teammates), merging them with any
 * edits here that aren't saved yet. Force runs it even while a save is in flight (after a conflict).
 */
async function pull(slug: string, force = false) {
  const ws = useWorkspaces.getState().workspaces[slug];
  if (!ws || ws.loaded === false || !ws.syncedAt || (!force && inflight.has(slug))) return;
  const res = await fetch(url(slug, `/records?since=${encodeURIComponent(ws.syncedAt)}`), {
    cache: "no-store",
  }).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as RecordChanges | null) : null;
  const base = baselines.get(slug);
  if (!body || !base?.records) return;
  let resave = false;
  useWorkspaces.setState((s) => {
    const current = s.workspaces[slug];
    if (!current || current.loaded === false) return s;
    const merged = pullInto(current.records, base.records ?? new Map(), body);
    baselines.set(slug, { ...base, records: merged.baseRecords });
    if (!merged.changed)
      return { workspaces: { ...s.workspaces, [slug]: { ...current, syncedAt: body.syncedAt } } };
    if (merged.added.length) markFresh(merged.added);
    const records = computeAll(blueprintOf(current), merged.records);
    resave = true;
    return {
      workspaces: { ...s.workspaces, [slug]: { ...current, syncedAt: body.syncedAt, records } },
    };
  });
  // Merged edits (and totals recalculated with the new records) still differ from the server: save them.
  if (resave && diffWorkspace(baselines.get(slug), useWorkspaces.getState().workspaces[slug]))
    scheduleSave(slug);
}

async function sendDelete(slug: string) {
  clearTimeout(timers.get(slug));
  pending.delete(slug);
  baselines.delete(slug);
  const res = await fetch(url(slug), { method: "DELETE" }).catch(() => null);
  if (!res?.ok)
    toast.error("Couldn't remove the workspace", { description: "Reload the page and try again." });
}

/** True while edits are waiting to reach the server. */
export const hasUnsavedChanges = () => pending.size > 0 || inflight.size > 0;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedChanges()) event.preventDefault();
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
        for (const w of body.workspaces) baselines.set(w.slug, baselineOf(w));
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
      if (ws.loaded === false) {
        void ensureLoaded(slug).then((ok) => ok && get().renameWorkspace(slug, name));
        return;
      }
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

    refresh: (slug) => pull(slug),

    ensureLoaded: (slug) => ensureLoaded(slug),

    setDoc: (slug, viewId, body) =>
      update(slug, (ws) => ({
        ...ws,
        docs: { ...ws.docs, [viewId]: { body, updatedAt: new Date().toISOString() } },
      })),

    saveSetup: (slug, progress) =>
      update(slug, (ws) => (ws.setup ? { ...ws, setup: { ...ws.setup, progress } } : ws)),

    finishSetup: (slug, data, name, summary) => {
      if (get().workspaces[slug]?.loaded === false) {
        void ensureLoaded(slug).then((ok) => ok && get().finishSetup(slug, data, name, summary));
        return;
      }
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
      });
    },

    applyChange: (slug, plan, by) => {
      const ws = get().workspaces[slug];
      // Plans need the records and every version; workspaces are loaded before anything can plan on them.
      if (!ws || ws.loaded === false) return null;
      const { workspace, entry } = applyPlan(ws, plan, { by });
      update(slug, () => workspace);
      return entry;
    },

    undoChange: (slug, changeId) =>
      update(slug, (ws) => (ws.loaded === false ? ws : (undoPlan(ws, changeId) ?? ws))),
    redoChange: (slug, changeId) =>
      update(slug, (ws) => (ws.loaded === false ? ws : (redoPlan(ws, changeId) ?? ws))),
  };
});
