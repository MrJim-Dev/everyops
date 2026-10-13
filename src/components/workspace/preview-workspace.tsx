"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import type { WorkspaceData } from "@/lib/blueprint/types";
import { getCatalogSystem } from "@/lib/catalog";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceMissing } from "./workspace-missing";

/**
 * Provides a community system with fresh sample data. Visitors can click
 * around and try it; nothing is saved.
 */
export function PreviewWorkspace({ systemId, children }: { systemId: string; children: ReactNode }) {
  const system = getCatalogSystem(systemId);
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
            blueprint: data.blueprint,
            records: data.records,
            data,
            commit: setData,
          }
        : null,
    [data, system],
  );

  if (!system) return <WorkspaceMissing kind="system" />;
  if (!value) return <ShellSkeleton />;
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}
