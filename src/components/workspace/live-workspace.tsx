"use client";

import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import type { WorkspaceData } from "@/lib/blueprint/types";
import { useHydrated } from "@/lib/store/use-hydrated";
import { blueprintOf, roleOf, useWorkspaces } from "@/lib/store/workspaces";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceMissing } from "./workspace-missing";

const NO_DOCS = {};

/** Provides a saved workspace from this browser's storage. */
export function LiveWorkspace({ slug, children }: { slug: string; children: ReactNode }) {
  const hydrated = useHydrated();
  const workspace = useWorkspaces((s) => s.workspaces[slug]);
  const setRecords = useWorkspaces((s) => s.setRecords);
  const setDoc = useWorkspaces((s) => s.setDoc);
  const open = useWorkspaces((s) => s.open);
  const me = useWorkspaces((s) => s.owner);

  useEffect(() => {
    if (hydrated) open(slug);
  }, [hydrated, slug, open]);

  const commit = useCallback((next: WorkspaceData) => setRecords(slug, next.records), [setRecords, slug]);
  const saveDoc = useCallback((viewId: string, body: string) => setDoc(slug, viewId, body), [setDoc, slug]);

  const value = useMemo(() => {
    if (!workspace) return null;
    const blueprint = blueprintOf(workspace);
    return {
      mode: "live" as const,
      id: slug,
      basePath: `/w/${slug}`,
      name: workspace.name,
      role: roleOf(workspace, me) ?? ("viewer" as const),
      isShared: workspace.ownerId !== me,
      blueprint,
      records: workspace.records,
      data: { blueprint, records: workspace.records },
      commit,
      docs: workspace.docs ?? NO_DOCS,
      saveDoc,
    };
  }, [workspace, slug, commit, saveDoc, me]);

  if (!hydrated) return <ShellSkeleton />;
  if (!value) return <WorkspaceMissing />;
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}
