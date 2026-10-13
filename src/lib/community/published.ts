"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Blueprint, IconName } from "@/lib/blueprint/types";
import type { CatalogCategory, CatalogSystem } from "@/lib/catalog";

/**
 * Systems people publish from their workspaces. Only the blueprint is
 * published, never records. Stored in this browser until the backend lands.
 */
export type PublishedSystem = {
  id: string;
  name: string;
  summary: string;
  category: CatalogCategory;
  license: "MIT" | "Apache-2.0";
  version: string;
  authorId: string;
  authorName: string;
  /** Workspace it was published from: owner account + slug. */
  source: { owner: string; slug: string };
  blueprint: Blueprint;
  publishedAt: string;
  updatedAt: string;
};

export type PublishInput = Pick<PublishedSystem, "name" | "summary" | "category" | "license">;

type State = {
  systems: PublishedSystem[];
  publish: (
    input: PublishInput &
      Omit<PublishedSystem, keyof PublishInput | "id" | "version" | "publishedAt" | "updatedAt">,
  ) => PublishedSystem;
  update: (id: string, input: PublishInput, blueprint: Blueprint) => PublishedSystem | null;
  unpublish: (id: string) => void;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "system";
const bump = (version: string) => {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${(minor || 0) + 1}`;
};

export const usePublished = create<State>()(
  persist(
    (set, get) => ({
      systems: [],
      publish: (input) => {
        const now = new Date().toISOString();
        let id = `${slugify(input.name)}-${input.authorId.slice(-4)}`;
        for (let i = 2; get().systems.some((s) => s.id === id); i++)
          id = `${slugify(input.name)}-${input.authorId.slice(-4)}-${i}`;
        const system: PublishedSystem = { ...input, id, version: "1.0", publishedAt: now, updatedAt: now };
        set((s) => ({ systems: [system, ...s.systems] }));
        return system;
      },
      update: (id, input, blueprint) => {
        const current = get().systems.find((s) => s.id === id);
        if (!current) return null;
        const next = {
          ...current,
          ...input,
          blueprint,
          version: bump(current.version),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ systems: s.systems.map((x) => (x.id === id ? next : x)) }));
        return next;
      },
      unpublish: (id) => set((s) => ({ systems: s.systems.filter((x) => x.id !== id) })),
    }),
    {
      name: "everyops.community",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);

const ICONS: Record<CatalogCategory, IconName> = {
  booking: "calendar",
  finance: "wallet",
  social: "megaphone",
  hris: "users",
  pos: "storefront",
};

/** What a blueprint contains, in words, for listings. */
export function describeBlueprint(bp: Blueprint): string[] {
  const names: Partial<Record<string, string>> = {
    slot_grid: "Schedule",
    checkout: "Register",
    approval_queue: "Approval queue",
    kanban: "Board",
    calendar: "Calendar",
  };
  const screens = [...new Set(bp.views.map((v) => names[v.type]).filter((n): n is string => !!n))];
  return [
    ...bp.entities.map((e) => `${e.name} records`),
    ...screens,
    ...(bp.rules.length ? [`${bp.rules.length} automatic ${bp.rules.length === 1 ? "rule" : "rules"}`] : []),
  ].slice(0, 5);
}

export function toCatalogSystem(p: PublishedSystem): CatalogSystem {
  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    category: p.category,
    icon: ICONS[p.category],
    author: p.authorName,
    license: p.license,
    version: p.version,
    uses: 0,
    includes: describeBlueprint(p.blueprint),
    authorId: p.authorId,
    // Published systems carry no records; previews start empty.
    sample: (_now, workspaceName) => ({
      blueprint: { ...p.blueprint, version: 1, workspaceName: workspaceName ?? p.name },
      records: [],
    }),
  };
}
