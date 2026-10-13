"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { usePublished } from "@/lib/community/published";
import { useWorkspaces } from "@/lib/store/workspaces";

/**
 * Loads saved data after mount, then keeps the workspace list in step with
 * the session: each account sees only its own workspaces.
 */
export function StoreHydration() {
  const { data, isPending } = authClient.useSession();
  const [workspacesReady, setWorkspacesReady] = useState(false);

  useEffect(() => {
    const unsub = useWorkspaces.persist.onFinishHydration(() => setWorkspacesReady(true));
    void useWorkspaces.persist.rehydrate();
    void usePublished.persist.rehydrate();
    if (useWorkspaces.persist.hasHydrated()) setWorkspacesReady(true);
    return unsub;
  }, []);

  const userId = data?.user.id ?? null;
  const name = data?.user.name;
  const email = data?.user.email;
  useEffect(() => {
    if (!workspacesReady || isPending) return;
    useWorkspaces.getState().setOwner(userId, userId && name && email ? { name, email } : undefined);
  }, [workspacesReady, isPending, userId, name, email]);

  return null;
}
