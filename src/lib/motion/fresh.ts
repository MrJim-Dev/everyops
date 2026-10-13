"use client";

import { create } from "zustand";

/** How long a just-changed record keeps its highlight. Matches --animate-flash. */
const FRESH_MS = 1200;

type FreshState = { ids: Record<string, true>; mark: (ids: string[]) => void };

/**
 * Records the person just created or changed, so views can briefly highlight
 * them. Explicit marking (instead of comparing timestamps) keeps seeded and
 * loaded data from flashing.
 */
export const useFreshStore = create<FreshState>()((set) => ({
  ids: {},
  mark: (ids) => {
    if (!ids.length) return;
    set((s) => ({ ids: { ...s.ids, ...Object.fromEntries(ids.map((id) => [id, true as const])) } }));
    setTimeout(() => {
      set((s) => {
        const next = { ...s.ids };
        for (const id of ids) delete next[id];
        return { ids: next };
      });
    }, FRESH_MS);
  },
}));

export function useIsFresh(id: string): boolean {
  return useFreshStore((s) => id in s.ids);
}

export function markFresh(ids: string[]) {
  useFreshStore.getState().mark(ids);
}
