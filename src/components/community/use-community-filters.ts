"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { CATEGORIES, type CatalogCategory, type CatalogSystem } from "@/lib/catalog";

export type Source = "catalog" | "community" | "yours";
export type Sort = "uses" | "name";

export const SOURCES: { id: Source; label: string }[] = [
  { id: "catalog", label: "Curated" },
  { id: "community", label: "Published here" },
  { id: "yours", label: "Yours" },
];

const isCategory = (v: string): v is CatalogCategory => CATEGORIES.some((c) => c.id === v);
const isSource = (v: string): v is Source => SOURCES.some((s) => s.id === v);

export function sourceOf(system: CatalogSystem, userId?: string): Source {
  if (!system.authorId) return "catalog";
  return system.authorId === userId ? "yours" : "community";
}

/**
 * Community filters live in the URL so a filtered view can be shared or bookmarked.
 * Updates use history.replaceState: instant, no server round trip, and Next keeps
 * useSearchParams in sync.
 */
export function useCommunityFilters() {
  const params = useSearchParams();
  const categories = (params.get("category")?.split(",") ?? []).filter(isCategory);
  const sources = (params.get("source")?.split(",") ?? []).filter(isSource);
  const query = params.get("q") ?? "";
  const sort: Sort = params.get("sort") === "name" ? "name" : "uses";
  const selectedId = params.get("system");

  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  const toggle = <T extends string>(key: string, list: T[], value: T) => {
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    update({ [key]: next.join(",") || null });
  };

  return {
    categories,
    sources,
    query,
    sort,
    selectedId,
    active: categories.length + sources.length > 0 || query.trim().length > 0,
    setQuery: (q: string) => update({ q: q || null }),
    setSort: (s: Sort) => update({ sort: s === "uses" ? null : s }),
    toggleCategory: (c: CatalogCategory) => toggle("category", categories, c),
    toggleSource: (s: Source) => toggle("source", sources, s),
    clear: () => update({ category: null, source: null, q: null }),
    open: (id: string) => update({ system: id }),
    close: () => update({ system: null }),
  };
}
