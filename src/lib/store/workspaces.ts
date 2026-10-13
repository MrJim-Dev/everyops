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

/** Where Ask Hulma's setup interview left off, so a refresh doesn't lose answers. */
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
  /** Set while Ask Hulma is still setting the workspace up. */
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
  /** undefined until the session is known; null when signed out. */
  owner: string | null | undefined;
  /** Switch to an account's workspaces, creating the demo workspaces on its first visit. */
  setOwner: (owner: string | null) => void;
  resetDemo: () => void;
  renameWorkspace: (slug: string, name: string) => void;
  deleteWorkspace: (slug: string) => void;
  /** Removes every workspace of an account (account deletion). */
  dropOwner: (owner: string) => void;
  open: (slug: string) => void;
  createWorkspace: (input: NewWorkspace) => string;
  setRecords: (slug: string, records: DataRecord[]) => void;
  saveSetup: (slug: string, progress: SetupProgress) => void;
  finishSetup: (slug: string, data: WorkspaceData, name: string, summary: string) => void;
  applyChange: (slug: string, plan: ChangePlan) => ChangeEntry | null;
  undoChange: (slug: string, changeId: string) => void;
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
          return { ...next, byOwner: { ...state.byOwner, [state.owner]: next.workspaces } };
        });

      return {
        workspaces: {},
        byOwner: {},
        owner: undefined,

        setOwner: (owner) =>
          rawSet((state) => {
            if (!owner) return { owner: null, workspaces: {} };
            const existing = state.byOwner[owner];
            const workspaces = existing ?? demoWorkspaces();
            return {
              owner,
              workspaces,
              byOwner: existing ? state.byOwner : { ...state.byOwner, [owner]: workspaces },
            };
          }),

        resetDemo: () => set({ workspaces: demoWorkspaces() }),

        renameWorkspace: (slug, name) => {
          const ws = get().workspaces[slug];
          const clean = name.trim();
          if (!ws || !clean || clean === ws.name) return;
          // A rename is a change like any other: versioned, in History, and undoable.
          get().applyChange(slug, {
            request: `Rename the workspace to \${clean}`,
            title: "Rename workspace",
            facts: [],
            steps: [{ kind: "change", label: "Workspace name", detail: `\${ws.name} → \${clean}` }],
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
            return { byOwner: rest, ...(s.owner === owner ? { owner: null, workspaces: {} } : {}) };
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
      name: "hulma.workspaces",
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
