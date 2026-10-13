"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/store";
import { useWorkspaces } from "@/lib/store/workspaces";

/**
 * Loads saved data after mount, then keeps the workspace list in step with
 * the session: each account sees only its own workspaces.
 */
export function StoreHydration() {
  useEffect(() => {
    let authReady = false;
    let workspacesReady = false;
    const sync = () => {
      if (authReady && workspacesReady) useWorkspaces.getState().setOwner(useAuth.getState().sessionId);
    };
    const unsubAuthReady = useAuth.persist.onFinishHydration(() => {
      authReady = true;
      void useAuth.getState().seed();
      sync();
    });
    const unsubWorkspacesReady = useWorkspaces.persist.onFinishHydration(() => {
      workspacesReady = true;
      sync();
    });
    const unsubSession = useAuth.subscribe((state, previous) => {
      if (state.sessionId !== previous.sessionId) sync();
    });
    void useAuth.persist.rehydrate();
    void useWorkspaces.persist.rehydrate();
    return () => {
      unsubAuthReady();
      unsubWorkspacesReady();
      unsubSession();
    };
  }, []);
  return null;
}
