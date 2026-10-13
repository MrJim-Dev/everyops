"use client";

import { useMemo } from "react";
import { useWorkspaces } from "./workspaces";

export type WorkspaceSummary = {
  slug: string;
  name: string;
  summary: string;
  openedAt: string;
  settingUp: boolean;
  shared: boolean;
};

/** Workspaces in this browser, most recently opened first. */
export function useRecentWorkspaces(): WorkspaceSummary[] {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const shared = useWorkspaces((s) => s.shared);
  return useMemo(
    () =>
      Object.values(workspaces)
        .map((w) => ({
          slug: w.slug,
          name: w.name,
          summary: w.summary,
          openedAt: w.openedAt,
          settingUp: !!w.setup,
          shared: w.slug in shared,
        }))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [workspaces, shared],
  );
}
