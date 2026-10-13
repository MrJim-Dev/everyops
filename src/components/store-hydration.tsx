"use client";

import { useEffect } from "react";
import { useWorkspaces } from "@/lib/store/workspaces";

/** Reads saved workspaces after mount and adds the demo workspaces on first visit. */
export function StoreHydration() {
  useEffect(() => {
    const unsubscribe = useWorkspaces.persist.onFinishHydration(() => useWorkspaces.getState().seed());
    void useWorkspaces.persist.rehydrate();
    return unsubscribe;
  }, []);
  return null;
}
