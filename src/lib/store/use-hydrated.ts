"use client";

import { useWorkspaces } from "./workspaces";

/** True once the signed-in account's workspaces are loaded from this browser. */
export function useHydrated(): boolean {
  return useWorkspaces((s) => s.owner !== undefined);
}
