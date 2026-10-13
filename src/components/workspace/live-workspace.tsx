"use client";

import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import type { WorkspaceData } from "@/lib/blueprint/types";
import { useHydrated } from "@/lib/store/use-hydrated";
import { blueprintOf, useWorkspaces } from "@/lib/store/workspaces";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceMissing } from "./workspace-missing";

/** Provides a saved workspace from this browser's storage. */
export function LiveWorkspace({ slug, children }: { slug: string; children: ReactNode }) {
  const hydrated = useHydrated();
  const workspace = useWorkspaces((s) => s.workspaces[slug]);
  const setRecords = useWorkspaces((s) => s.setRecords);
  const open = useWorkspaces((s) => s.open);

  useEffect(() => {
    if (hydrated) open(slug);
  }, [hydrated, slug, open]);

  const commit = useCallback((next: WorkspaceData) => setRecords(slug, next.records), [setRecords, slug]);

  const value = useMemo(() => {
    if (!workspace) return null;
    const blueprint = blueprintOf(workspace);
    return {
      mode: "live" as const,
      id: slug,
      basePath: `/w/${slug}`,
      name: workspace.name,
      blueprint,
      records: workspace.records,
      data: { blueprint, records: workspace.records },
      commit,
    };
  }, [workspace, slug, commit]);

  if (!hydrated) return <ShellSkeleton />;
  if (!value) return <WorkspaceMissing />;
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}
