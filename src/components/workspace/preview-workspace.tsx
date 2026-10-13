"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import type { WorkspaceData } from "@/lib/blueprint/types";
import { usePublished } from "@/lib/community/published";
import { useCatalogSystem } from "@/lib/community/use-catalog";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceMissing } from "./workspace-missing";

/**
 * Provides a community system with fresh sample data. Visitors can click
 * around and try it; nothing is saved.
 */
export function PreviewWorkspace({ systemId, children }: { systemId: string; children: ReactNode }) {
  const system = useCatalogSystem(systemId);
  // Published systems load from this browser; wait for them before deciding a system doesn't exist.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const done = () => setChecked(true);
    if (usePublished.persist.hasHydrated()) done();
    return usePublished.persist.onFinishHydration(done);
  }, []);
  const [data, setData] = useState<WorkspaceData | null>(null);

  // Sample data is dated around "today", so build it in the browser only.
  useEffect(() => {
    if (system) setData(system.sample(new Date()));
  }, [system]);

  const value = useMemo(
    () =>
      data && system
        ? {
            mode: "preview" as const,
            id: system.id,
            basePath: `/preview/${system.id}`,
            name: system.name,
            role: "owner" as const,
            isShared: false,
            blueprint: data.blueprint,
            records: data.records,
            data,
            commit: setData,
          }
        : null,
    [data, system],
  );

  if (!system) return checked ? <WorkspaceMissing kind="system" /> : <ShellSkeleton />;
  if (!value) return <ShellSkeleton />;
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}
