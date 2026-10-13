"use client";

import { useEffect, useMemo } from "react";
import type { CatalogSystem } from "@/lib/catalog";
import { toCatalogSystem, usePublished } from "./published";

/** Community systems from the database: what people published first, then the official templates. */
export function useCatalog(): CatalogSystem[] {
  const systems = usePublished((s) => s.systems);
  const load = usePublished((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return useMemo(() => systems.map(toCatalogSystem), [systems]);
}

/** True once community systems have loaded (or failed to). */
export function useCatalogLoaded(): boolean {
  return usePublished((s) => s.status === "ready" || s.status === "error");
}

export function useCatalogSystem(id: string): CatalogSystem | undefined {
  return useCatalog().find((s) => s.id === id);
}
