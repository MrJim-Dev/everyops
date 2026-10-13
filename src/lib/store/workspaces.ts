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

const DATA_VERSION = 2;

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
  workspaces: Record<string, Workspace>;
  seeded: boolean;
  seed: () => void;
  resetDemo: () => void;
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
    (set, get) => ({
      workspaces: {},
      seeded: false,

      seed: () => {
        if (get().seeded) return;
        set({ workspaces: { ...demoWorkspaces(), ...get().workspaces }, seeded: true });
      },

      resetDemo: () => set({ workspaces: demoWorkspaces(), seeded: true }),

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
    }),
    {
      name: "hulma.workspaces",
      // Bump when demo blueprints change. Saved data from an older version is replaced by fresh demos;
      // this is a frontend prototype, so there is no per-version migration yet.
      version: DATA_VERSION,
      migrate: () => ({ workspaces: {}, seeded: false }),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ workspaces: s.workspaces, seeded: s.seeded }),
      // Data lives in the browser; hydrate after mount to keep SSR markup stable.
      skipHydration: true,
    },
  ),
);
