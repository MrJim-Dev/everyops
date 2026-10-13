"use client";

import { PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { ChangeSheet } from "@/components/changes/change-sheet";
import { ViewTabs } from "@/components/motion/view-tabs";
import { useRecordPanels } from "@/components/records/record-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { ViewEmpty } from "@/components/views/view-empty";
import { CREATABLE, ViewRenderer } from "@/components/views/view-renderer";
import { Dashboard } from "@/components/widgets/dashboard";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getSystem, getView } from "@/lib/blueprint/lookup";
import type { View } from "@/lib/blueprint/types";
import { canEdit, canManage } from "@/lib/store/workspaces";

/** One system page: header, view tabs, and the active view or dashboard. */
export function SystemPage({ systemId, viewId }: { systemId?: string; viewId?: string }) {
  const ws = useWorkspace();
  const { openCreate } = useRecordPanels();
  const [changing, setChanging] = useState(false);
  const system = systemId ? getSystem(ws.blueprint, systemId) : ws.blueprint.systems[0];

  if (!system) {
    return (
      <ViewEmpty
        title="This page doesn't exist"
        description="The system may have been renamed or removed. Pick one from the sidebar."
      />
    );
  }

  const views = system.viewIds.map((id) => getView(ws.blueprint, id)).filter((v): v is View => !!v);
  const active = views.find((v) => v.id === viewId) ?? views[0];
  const entity = active ? getEntity(ws.blueprint, active.entityId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={system.name}
        actions={
          <>
            {ws.mode === "live" && canManage(ws.role) ? (
              <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
                <SparkleIcon data-icon="inline-start" />
                Ask for a change
              </Button>
            ) : null}
            {active && entity && CREATABLE.includes(active.type) && canEdit(ws.role) ? (
              <Button size="sm" onClick={() => openCreate(entity.id)}>
                <PlusIcon data-icon="inline-start" />
                New {entity.name.toLowerCase()}
              </Button>
            ) : null}
          </>
        }
      />
      {views.length > 1 ? (
        <ViewTabs
          groupId={`${ws.id}:${system.id}`}
          label={`${system.name} views`}
          activeId={active?.id}
          items={views.map((view) => ({
            id: view.id,
            href: `${ws.basePath}/${system.id}/${view.id}`,
            label: view.name,
          }))}
        />
      ) : (
        <div className="border-b" />
      )}
      {active ? <ViewRenderer view={active} /> : <Dashboard system={system} />}
      {ws.mode === "live" && canManage(ws.role) ? (
        <ChangeSheet open={changing} onOpenChange={setChanging} />
      ) : null}
    </div>
  );
}
