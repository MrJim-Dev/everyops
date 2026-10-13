"use client";

import { useSyncExternalStore } from "react";
import { useWorkspaces } from "./workspaces";

const subscribe = (callback: () => void) => useWorkspaces.persist.onFinishHydration(callback);

/** True once saved workspaces have been read from this browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => useWorkspaces.persist.hasHydrated(),
    () => false,
  );
}
