"use client";

import { useWorkspaces } from "./workspaces";

/** True once the signed-in account's workspaces have loaded from the server (or failed to). */
export function useHydrated(): boolean {
  return useWorkspaces((s) => s.status === "ready" || s.status === "error");
}
