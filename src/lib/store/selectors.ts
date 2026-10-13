"use client";

import { useMemo } from "react";
import { useWorkspaces } from "./workspaces";

export type WorkspaceSummary = {
  slug: string;
  name: string;
  summary: string;
  openedAt: string;
  settingUp: boolean;
};

/** Workspaces in this browser, most recently opened first. */
export function useRecentWorkspaces(): WorkspaceSummary[] {
  const workspaces = useWorkspaces((s) => s.workspaces);
  return useMemo(
    () =>
      Object.values(workspaces)
        .map((w) => ({
          slug: w.slug,
          name: w.name,
          summary: w.summary,
          openedAt: w.openedAt,
          settingUp: !!w.setup,
        }))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [workspaces],
  );
}
