"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth/client";
import { useWorkspaces } from "@/lib/store/workspaces";

/** Loads the signed-in account's workspaces from the server whenever the session changes. */
export function StoreHydration() {
  const { data, isPending } = authClient.useSession();
  const userId = data?.user.id ?? null;
  useEffect(() => {
    if (isPending) return;
    void useWorkspaces.getState().load(userId);
  }, [isPending, userId]);
  return null;
}
