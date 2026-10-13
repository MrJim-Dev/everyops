"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Answers } from "@/lib/assistant/interview";
import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { DEMO_WORKSPACES } from "@/lib/catalog/demo-workspaces";
import {
  applyOps,
  type ChangePlan,
  commitChange,
  type RecordChange,
  revertChange,
} from "@/lib/engine/changes";

const DATA_VERSION = 3;

export type Role = "owner" | "admin" | "staff" | "viewer";
export const ROLES: { id: Exclude<Role, "owner">; label: string; description: string }[] = [
  { id: "admin", label: "Admin", description: "Manage systems, settings and the team" },
  { id: "staff", label: "Staff", description: "Add and edit records" },
  { id: "viewer", label: "Viewer", description: "View only" },
];
export type Member = {
  accountId: string;
  name: string;
  email: string;
  role: Exclude<Role, "owner">;
  joinedAt: string;
};
export type Invite = {
  token: string;
  email: string;
  role: Exclude<Role, "owner">;
  invitedAt: string;
  invitedBy: string;
};

/** Where Ask EveryOps's setup interview left off, so a refresh doesn't lose answers. */
export type SetupProgress = { stepIndex: number; answers: Answers; notes: string[] };

export type ChangeEntry = {
  id: string;
  request: string;
  title: string;
  steps: ChangePlan["steps"];
  fromVersion: number;
  toVersion: number;
  recordChanges: RecordChange[];
  appliedAt: string;
  undoneAt?: string;
};

export type Workspace = {
  slug: string;
  name: string;
  summary: string;
  createdAt: string;
  openedAt: string;
  source?: { systemId: string; version: string };
  /** Every blueprint version; versions[n - 1] is version n. */
  versions: Blueprint[];
  currentVersion: number;
  records: DataRecord[];
  changes: ChangeEntry[];
  /** The account that owns it. Filled in when the workspace list is built. */
  ownerId?: string;
  members?: Member[];
  invites?: Invite[];
  /** Set while Ask EveryOps is still setting the workspace up. */
  setup?: { prompt: string; progress?: SetupProgress };
};

type NewWorkspace = {
  name: string;
  summary: string;
  data: WorkspaceData;
  source?: Workspace["source"];
  setup?: Workspace["setup"];
  slug?: string;
};

type State = {
  /** The signed-in account's workspaces. Every action reads and writes this map. */
  workspaces: Record<string, Workspace>;
  /** All accounts' workspaces in this browser, by account id. */
  byOwner: Record<string, Record<string, Workspace>>;
  /** Workspaces shared with the signed-in account: view key → where it really lives. */
  shared: Record<string, { owner: string; slug: string }>;
  /** undefined until the session is known; null when signed out. */
  owner: string | null | undefined;
  /** Switch to an account's workspaces, creating the demo workspaces on its first visit. */
  setOwner: (owner: string | null) => void;
  resetDemo: () => void;
  renameWorkspace: (slug: string, name: string) => void;
  deleteWorkspace: (slug: string) => void;
  /** Removes every workspace of an account (account deletion). */
  dropOwner: (owner: string) => void;
  inviteMember: (slug: string, email: string, role: Member["role"], invitedBy: string) => Invite | null;
  revokeInvite: (slug: string, token: string) => void;
  setMemberRole: (slug: string, accountId: string, role: Member["role"]) => void;
  removeMember: (slug: string, accountId: string) => void;
  /** Accepts an invite for the given account. Returns the workspace key to open, or an error. */
  acceptInvite: (
    token: string,
    account: { id: string; name: string; email: string },
  ) => { ok: true; key: string } | { ok: false; message: string };
  leaveWorkspace: (key: string) => void;
  open: (slug: string) => void;
  createWorkspace: (input: NewWorkspace) => string;
  setRecords: (slug: string, records: DataRecord[]) => void;
  saveSetup: (slug: string, progress: SetupProgress) => void;
  finishSetup: (slug: string, data: WorkspaceData, name: string, summary: string) => void;
  applyChange: (slug: string, plan: ChangePlan) => ChangeEntry | null;
  undoChange: (slug: string, changeId: string) => void;
};

/** The signed-in account's role in a workspace. */
export function roleOf(ws: Workspace | undefined, accountId: string | null | undefined): Role | null {
  if (!ws || !accountId) return null;
  if (ws.ownerId === accountId) return "owner";
  return ws.members?.find((m) => m.accountId === accountId)?.role ?? null;
}

export const canManage = (role: Role | null) => role === "owner" || role === "admin";
export const canEdit = (role: Role | null) => role === "owner" || role === "admin" || role === "staff";

type Store = Record<string, Record<string, Workspace>>;

/** What an account sees: its own workspaces plus the ones shared with it (under a distinct key). */
function viewFor(byOwner: Store, owner: string) {
  const workspaces: Record<string, Workspace> = {};
  const shared: Record<string, { owner: string; slug: string }> = {};
  for (const [slug, ws] of Object.entries(byOwner[owner] ?? {})) workspaces[slug] = { ...ws, ownerId: owner };
  for (const [other, map] of Object.entries(byOwner)) {
    if (other === owner) continue;
    for (const ws of Object.values(map)) {
      if (!ws.members?.some((m) => m.accountId === owner)) continue;
      const key = `${ws.slug}~${other.slice(-4)}`;
      workspaces[key] = { ...ws, slug: key, ownerId: other };
      shared[key] = { owner: other, slug: ws.slug };
    }
  }
  return { workspaces, shared };
}

/** Files an edited view back: shared workspaces return to their owner, the rest stay with the account. */
function fileView(
  byOwner: Store,
  owner: string,
  shared: State["shared"],
  view: Record<string, Workspace>,
): Store {
  const next: Store = { ...byOwner };
  const own: Record<string, Workspace> = {};
  for (const [key, ws] of Object.entries(view)) {
    const home = shared[key];
    if (home) next[home.owner] = { ...next[home.owner], [home.slug]: { ...ws, slug: home.slug } };
    else own[key] = ws;
  }
  next[owner] = own;
  return next;
}

/** Finds a workspace by invite token across every account in this browser. */
export function findInvite(byOwner: Store, token: string) {
  for (const [owner, map] of Object.entries(byOwner))
    for (const ws of Object.values(map)) {
      const invite = ws.invites?.find((i) => i.token === token);
      if (invite) return { owner, workspace: ws, invite };
    }
  return null;
}

const randomToken = () => {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export function blueprintOf(ws: Workspace): Blueprint {
  return ws.versions[ws.currentVersion - 1];
}

export function dataOf(ws: Workspace): WorkspaceData {
  return { blueprint: blueprintOf(ws), records: ws.records };
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "workspace";

function uniqueSlug(base: string, taken: Record<string, unknown>) {
  let slug = slugify(base);
  for (let i = 2; slug in taken; i++) slug = `${slugify(base)}-${i}`;
  return slug;
}

function workspaceFrom(input: NewWorkspace, slug: string, now: string): Workspace {
  return {
    slug,
    name: input.name,
    summary: input.summary,
    createdAt: now,
    openedAt: now,
    source: input.source,
    versions: [{ ...input.data.blueprint, version: 1, workspaceName: input.name }],
    currentVersion: 1,
    records: input.data.records,
    changes: [],
    setup: input.setup,
  };
}

function demoWorkspaces(): Record<string, Workspace> {
  const now = new Date();
  const stamp = now.toISOString();
  return Object.fromEntries(
    DEMO_WORKSPACES.map((demo, i) => {
      const ws = workspaceFrom(
        {
          name: demo.name,
          summary: demo.summary,
          data: demo.build(now),
          source: demo.sourceId ? { systemId: demo.sourceId, version: "1.2" } : undefined,
        },
        demo.slug,
        stamp,
      );
      // Stagger "last opened" so the recent list has a stable order.
      ws.openedAt = new Date(now.getTime() - i * 60_000).toISOString();
      return [demo.slug, ws];
    }),
  );
}

export const useWorkspaces = create<State>()(
  persist(
    (rawSet, get) => {
      // Every write to `workspaces` is also filed under the current owner, so accounts never share data.
      const set = (partial: Partial<State> | ((s: State) => Partial<State> | State)) =>
        rawSet((state) => {
          const next = typeof partial === "function" ? partial(state) : partial;
          if (!next.workspaces || !state.owner || next === state) return next;
          const byOwner = fileView(state.byOwner, state.owner, state.shared, next.workspaces);
          // Rebuild the view so new workspaces get their owner and shared keys stay in sync.
          return { ...next, byOwner, ...viewFor(byOwner, state.owner) };
        });

      return {
        workspaces: {},
        byOwner: {},
        shared: {},
        owner: undefined,

        setOwner: (owner) =>
          rawSet((state) => {
            if (!owner) return { owner: null, workspaces: {}, shared: {} };
            const byOwner = state.byOwner[owner]
              ? state.byOwner
              : { ...state.byOwner, [owner]: demoWorkspaces() };
            return { owner, byOwner, ...viewFor(byOwner, owner) };
          }),

        resetDemo: () => set({ workspaces: demoWorkspaces() }),

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

        deleteWorkspace: (slug) =>
          set((s) => {
            const { [slug]: _removed, ...rest } = s.workspaces;
            return { workspaces: rest };
          }),

        dropOwner: (owner) =>
          rawSet((s) => {
            const { [owner]: _removed, ...rest } = s.byOwner;
            // Also remove the account from any workspace it was a member of.
            const cleaned: Store = Object.fromEntries(
              Object.entries(rest).map(([o, map]) => [
                o,
                Object.fromEntries(
                  Object.entries(map).map(([slug, ws]) => [
                    slug,
                    { ...ws, members: ws.members?.filter((m) => m.accountId !== owner) },
                  ]),
                ),
              ]),
            );
            if (s.owner === owner) return { byOwner: cleaned, owner: null, workspaces: {}, shared: {} };
            return { byOwner: cleaned, ...(s.owner ? viewFor(cleaned, s.owner) : {}) };
          }),

        inviteMember: (slug, email, role, invitedBy) => {
          const ws = get().workspaces[slug];
          const clean = email.trim().toLowerCase();
          if (!ws || !clean) return null;
          const invite: Invite = {
            token: randomToken(),
            email: clean,
            role,
            invitedAt: new Date().toISOString(),
            invitedBy,
          };
          set((s) => ({
            workspaces: {
              ...s.workspaces,
              [slug]: { ...ws, invites: [...(ws.invites ?? []).filter((i) => i.email !== clean), invite] },
            },
          }));
          return invite;
        },

        revokeInvite: (slug, token) =>
          set((s) => {
            const ws = s.workspaces[slug];
            if (!ws) return s;
            return {
              workspaces: {
                ...s.workspaces,
                [slug]: { ...ws, invites: ws.invites?.filter((i) => i.token !== token) },
              },
            };
          }),

        setMemberRole: (slug, accountId, role) =>
          set((s) => {
            const ws = s.workspaces[slug];
            if (!ws) return s;
            const members = ws.members?.map((m) => (m.accountId === accountId ? { ...m, role } : m));
            return { workspaces: { ...s.workspaces, [slug]: { ...ws, members } } };
          }),

        removeMember: (slug, accountId) =>
          set((s) => {
            const ws = s.workspaces[slug];
            if (!ws) return s;
            const members = ws.members?.filter((m) => m.accountId !== accountId);
            return { workspaces: { ...s.workspaces, [slug]: { ...ws, members } } };
          }),

        acceptInvite: (token, account) => {
          const state = get();
          const found = findInvite(state.byOwner, token);
          if (!found) return { ok: false, message: "This invite is no longer valid." };
          const { owner, workspace, invite } = found;
          if (owner === account.id) return { ok: false, message: "You already own this workspace." };
          if (invite.email !== account.email.toLowerCase())
            return {
              ok: false,
              message: `This invite was sent to ${invite.email}. Sign in with that account to join.`,
            };
          const member: Member = {
            accountId: account.id,
            name: account.name,
            email: account.email,
            role: invite.role,
            joinedAt: new Date().toISOString(),
          };
          const updated: Workspace = {
            ...workspace,
            invites: workspace.invites?.filter((i) => i.token !== token),
            members: [...(workspace.members ?? []).filter((m) => m.accountId !== account.id), member],
          };
          const byOwner = {
            ...state.byOwner,
            [owner]: { ...state.byOwner[owner], [workspace.slug]: updated },
          };
          rawSet({ byOwner, ...(state.owner ? viewFor(byOwner, state.owner) : {}) });
          return { ok: true, key: `${workspace.slug}~${owner.slice(-4)}` };
        },

        leaveWorkspace: (key) =>
          rawSet((s) => {
            const home = s.shared[key];
            if (!home || !s.owner) return s;
            const ws = s.byOwner[home.owner]?.[home.slug];
            if (!ws) return s;
            const me = s.owner;
            const updated = { ...ws, members: ws.members?.filter((m) => m.accountId !== me) };
            const byOwner = {
              ...s.byOwner,
              [home.owner]: { ...s.byOwner[home.owner], [home.slug]: updated },
            };
            return { byOwner, ...viewFor(byOwner, me) };
          }),

        open: (slug) =>
          set((s) => {
            const ws = s.workspaces[slug];
            if (!ws) return s;
            return { workspaces: { ...s.workspaces, [slug]: { ...ws, openedAt: new Date().toISOString() } } };
          }),

        createWorkspace: (input) => {
          const slug = input.slug ?? uniqueSlug(input.name, get().workspaces);
          const ws = workspaceFrom(input, slug, new Date().toISOString());
          set((s) => ({ workspaces: { ...s.workspaces, [slug]: ws } }));
          return slug;
        },

        setRecords: (slug, records) =>
          set((s) => {
            const ws = s.workspaces[slug];
            if (!ws) return s;
            return { workspaces: { ...s.workspaces, [slug]: { ...ws, records } } };
          }),

        saveSetup: (slug, progress) =>
          set((s) => {
            const ws = s.workspaces[slug];
            if (!ws?.setup) return s;
            return { workspaces: { ...s.workspaces, [slug]: { ...ws, setup: { ...ws.setup, progress } } } };
          }),

        finishSetup: (slug, data, name, summary) =>
          set((s) => {
            const ws = s.workspaces[slug];
            if (!ws) return s;
            const version = ws.versions.length + 1;
            return {
              workspaces: {
                ...s.workspaces,
                [slug]: {
                  ...ws,
                  name,
                  summary,
                  versions: [...ws.versions, { ...data.blueprint, version, workspaceName: name }],
                  currentVersion: version,
                  records: data.records,
                  setup: undefined,
                },
              },
            };
          }),

        applyChange: (slug, plan) => {
          const ws = get().workspaces[slug];
          if (!ws) return null;
          const current = blueprintOf(ws);
          const next = { ...applyOps(current, plan.ops), version: ws.versions.length + 1 };
          const { data, changes } = commitChange(dataOf(ws), next);
          const entry: ChangeEntry = {
            id: `change_${next.version}`,
            request: plan.request,
            title: plan.title,
            steps: plan.steps,
            fromVersion: ws.currentVersion,
            toVersion: next.version,
            recordChanges: changes,
            appliedAt: new Date().toISOString(),
          };
          set((s) => ({
            workspaces: {
              ...s.workspaces,
              [slug]: {
                ...ws,
                name: next.workspaceName,
                versions: [...ws.versions, next],
                currentVersion: next.version,
                records: data.records,
                changes: [entry, ...ws.changes],
              },
            },
          }));
          return entry;
        },

        undoChange: (slug, changeId) =>
          set((s) => {
            const ws = s.workspaces[slug];
            const entry = ws?.changes.find((c) => c.id === changeId);
            if (!ws || !entry || entry.undoneAt || ws.currentVersion !== entry.toVersion) return s;
            const previous = ws.versions[entry.fromVersion - 1];
            const restored = revertChange(dataOf(ws), previous, entry.recordChanges);
            return {
              workspaces: {
                ...s.workspaces,
                [slug]: {
                  ...ws,
                  name: previous.workspaceName,
                  currentVersion: entry.fromVersion,
                  records: restored.records,
                  changes: ws.changes.map((c) =>
                    c.id === changeId ? { ...c, undoneAt: new Date().toISOString() } : c,
                  ),
                },
              },
            };
          }),
      };
    },
    {
      name: "everyops.workspaces",
      // Bump when demo blueprints change. Saved data from an older version is replaced by fresh demos;
      // this is a frontend prototype, so there is no per-version migration yet.
      version: DATA_VERSION,
      migrate: () => ({ byOwner: {} }),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ byOwner: s.byOwner }),
      // Data lives in the browser; hydrate after mount to keep SSR markup stable.
      skipHydration: true,
    },
  ),
);
