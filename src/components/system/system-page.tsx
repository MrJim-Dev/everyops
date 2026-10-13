"use client";

import { PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { ChangeSheet } from "@/components/changes/change-sheet";
import { useRecordPanels } from "@/components/records/record-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { ViewEmpty } from "@/components/views/view-empty";
import { CREATABLE, ViewRenderer } from "@/components/views/view-renderer";
import { Dashboard } from "@/components/widgets/dashboard";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getEntity, getSystem, getView } from "@/lib/blueprint/lookup";
import type { View } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";

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
            {ws.mode === "live" ? (
              <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
                <SparkleIcon data-icon="inline-start" />
                Ask for a change
              </Button>
            ) : null}
            {active && entity && CREATABLE.includes(active.type) ? (
              <Button size="sm" onClick={() => openCreate(entity.id)}>
                <PlusIcon data-icon="inline-start" />
                New {entity.name.toLowerCase()}
              </Button>
            ) : null}
          </>
        }
      />
      {views.length > 1 ? (
        <nav aria-label={`${system.name} views`} className="flex shrink-0 gap-5 border-b px-5">
          {views.map((view) => {
            const selected = view.id === active?.id;
            return (
              <Link
                key={view.id}
                href={`${ws.basePath}/${system.id}/${view.id}`}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "relative py-2.5 text-[13px] outline-none transition-colors focus-visible:text-foreground",
                  selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {view.name}
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : (
        <div className="border-b" />
      )}
      {active ? <ViewRenderer view={active} /> : <Dashboard system={system} />}
      {ws.mode === "live" ? <ChangeSheet open={changing} onOpenChange={setChanging} /> : null}
    </div>
  );
}
