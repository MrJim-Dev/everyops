"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/store";
import { useWorkspaces } from "@/lib/store/workspaces";

/** Reads saved data after mount: the session, then workspaces (with demos on first visit). */
export function StoreHydration() {
  useEffect(() => {
    const unsubAuth = useAuth.persist.onFinishHydration(() => void useAuth.getState().seed());
    const unsubWorkspaces = useWorkspaces.persist.onFinishHydration(() => useWorkspaces.getState().seed());
    void useAuth.persist.rehydrate();
    void useWorkspaces.persist.rehydrate();
    return () => {
      unsubAuth();
      unsubWorkspaces();
    };
  }, []);
  return null;
}
