"use client";

import { create } from "zustand";
import type { Blueprint, DataRecord, IconName } from "@/lib/blueprint/types";
import type { CatalogCategory, CatalogSystem } from "@/lib/catalog";
import { freshSample } from "@/lib/catalog/shift";
import { describeBlueprint } from "./describe";

export { describeBlueprint };

/** A community system from the database: official templates and what people published. */
export type PublishedSystem = {
  id: string;
  official: boolean;
  name: string;
  summary: string;
  category: CatalogCategory;
  icon: IconName;
  author: string;
  license: "MIT" | "Apache-2.0";
  version: string;
  uses: number;
  active?: number;
  recent?: number;
  includes: string[];
  authorId: string | null;
  sourceWorkspaceId: string | null;
  blueprint: Blueprint;
  sample?: { records: DataRecord[]; builtOn: string };
  publishedAt: string;
  updatedAt: string;
};

export type PublishInput = {
  name: string;
  summary: string;
  category: CatalogCategory;
  license: "MIT" | "Apache-2.0";
};

const ICONS: Record<CatalogCategory, IconName> = {
  booking: "calendar",
  finance: "wallet",
  social: "megaphone",
  hris: "users",
  pos: "storefront",
};

type State = {
  systems: PublishedSystem[];
  status: "idle" | "loading" | "ready" | "error";
  load: (force?: boolean) => Promise<void>;
  publish: (
    workspaceId: string,
    input: PublishInput,
    blueprint: Blueprint,
  ) => Promise<PublishedSystem | string>;
  update: (
    id: string,
    workspaceId: string,
    input: PublishInput,
    blueprint: Blueprint,
  ) => Promise<PublishedSystem | string>;
  unpublish: (id: string) => Promise<boolean>;
};

const body = (workspaceId: string, input: PublishInput, blueprint: Blueprint) =>
  JSON.stringify({
    workspaceId,
    ...input,
    icon: ICONS[input.category],
    includes: describeBlueprint(blueprint),
    blueprint,
  });

async function call(url: string, init: RequestInit): Promise<PublishedSystem | string> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const data = (await res.json().catch(() => null)) as { system?: PublishedSystem; message?: string } | null;
  return data?.system ?? data?.message ?? "Something went wrong. Try again.";
}

export const usePublished = create<State>()((set, get) => ({
  systems: [],
  status: "idle",
  load: async (force) => {
    if (!force && (get().status === "ready" || get().status === "loading")) return;
    set({ status: "loading" });
    try {
      const res = await fetch("/api/community", { cache: "no-store" });
      const data = (await res.json()) as { systems: PublishedSystem[] };
      set({ systems: data.systems, status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },
  publish: async (workspaceId, input, blueprint) => {
    const result = await call("/api/community", {
      method: "POST",
      body: body(workspaceId, input, blueprint),
    });
    if (typeof result !== "string") set((s) => ({ systems: [result, ...s.systems] }));
    return result;
  },
  update: async (id, workspaceId, input, blueprint) => {
    const result = await call(`/api/community/${id}`, {
      method: "PUT",
      body: body(workspaceId, input, blueprint),
    });
    if (typeof result !== "string")
      set((s) => ({ systems: s.systems.map((x) => (x.id === id ? result : x)) }));
    return result;
  },
  unpublish: async (id) => {
    const res = await fetch(`/api/community/${id}`, { method: "DELETE" });
    if (res.ok) set((s) => ({ systems: s.systems.filter((x) => x.id !== id) }));
    return res.ok;
  },
}));

export function toCatalogSystem(p: PublishedSystem): CatalogSystem {
  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    category: p.category,
    icon: p.icon ?? ICONS[p.category],
    author: p.author,
    license: p.license,
    version: p.version,
    uses: p.uses,
    active: p.active ?? 0,
    recent: p.recent ?? 0,
    includes: p.includes,
    authorId: p.authorId ?? undefined,
    publishedAt: p.publishedAt,
    // Official templates carry sample data, moved to today; published systems start empty.
    sample: (now, workspaceName) =>
      p.sample
        ? freshSample(p.blueprint, p.sample.records, p.sample.builtOn, workspaceName ?? p.name, now)
        : { blueprint: { ...p.blueprint, version: 1, workspaceName: workspaceName ?? p.name }, records: [] },
  };
}
