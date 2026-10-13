"use client";

import { useMemo } from "react";
import { CATALOG, type CatalogSystem } from "@/lib/catalog";
import { toCatalogSystem, usePublished } from "./published";

/** Community systems: what people published here, then the curated catalog. */
export function useCatalog(): CatalogSystem[] {
  const published = usePublished((s) => s.systems);
  return useMemo(() => [...published.map(toCatalogSystem), ...CATALOG], [published]);
}

export function useCatalogSystem(id: string): CatalogSystem | undefined {
  return useCatalog().find((s) => s.id === id);
}
