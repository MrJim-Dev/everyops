"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { CATEGORIES, type CatalogCategory, type CatalogSystem } from "@/lib/catalog";

export type Source = "all" | "official" | "community" | "yours";
export type Sort = "uses" | "newest" | "name";

export const SOURCES: Record<Source, string> = {
  all: "All sources",
  official: "Official",
  community: "From the community",
  yours: "Published by you",
};

const isCategory = (v: string | null): v is CatalogCategory => CATEGORIES.some((c) => c.id === v);
const isSource = (v: string | null): v is Source => !!v && v in SOURCES;

/** Which shelf a system sits on: built-in, published by someone else, or by you. */
export function sourceOf(system: CatalogSystem, userId?: string): Exclude<Source, "all"> {
  if (!system.authorId) return "official";
  return system.authorId === userId ? "yours" : "community";
}

/**
 * Community filters live in the URL so a view can be shared or bookmarked. Updates use
 * history.replaceState: instant, no server round trip, and useSearchParams stays in sync.
 */
export function useCommunityFilters() {
  const params = useSearchParams();
  const category = isCategory(params.get("category")) ? (params.get("category") as CatalogCategory) : "all";
  const source: Source = isSource(params.get("source")) ? (params.get("source") as Source) : "all";
  const sort: Sort =
    params.get("sort") === "name" ? "name" : params.get("sort") === "newest" ? "newest" : "uses";
  const query = params.get("q") ?? "";
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

  return {
    category,
    source,
    sort,
    query,
    selectedId,
    active: category !== "all" || source !== "all" || query.trim().length > 0,
    setCategory: (c: string) => update({ category: c === "all" ? null : c }),
    setSource: (s: Source) => update({ source: s === "all" ? null : s }),
    setSort: (s: Sort) => update({ sort: s === "uses" ? null : s }),
    setQuery: (q: string) => update({ q: q || null }),
    clear: () => update({ category: null, source: null, q: null }),
    open: (id: string) => update({ system: id }),
    close: () => update({ system: null }),
  };
}
