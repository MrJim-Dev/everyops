"use client";

import { ArrowCounterClockwiseIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ViewEmpty } from "@/components/views/view-empty";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatDateTime } from "@/lib/format";
import { markFresh } from "@/lib/motion/fresh";
import { canEdit, canManage, useWorkspaces } from "@/lib/store/workspaces";

export function HistoryList() {
  const ws = useWorkspace();
  const workspace = useWorkspaces((s) => s.workspaces[ws.id]);
  const undo = useWorkspaces((s) => s.undoChange);
  const changes = workspace?.changes ?? [];

  if (!workspace || changes.length === 0) {
    return (
      <ViewEmpty
        title="No changes yet"
        description="When you ask EveryOps to change this workspace, each version appears here and can be undone."
      />
    );
  }

  return (
    <ol className="divide-y">
      {changes.map((entry, index) => {
        // Changes are undone newest first, so only the latest one still applied can be undone.
        const isCurrent =
          !entry.undoneAt &&
          workspace.currentVersion === entry.toVersion &&
          changes.slice(0, index).every((c) => c.undoneAt);
        // Staff can undo the data changes they're allowed to make; owners and admins anything.
        const mayUndo =
          canManage(ws.role) ||
          (canEdit(ws.role) && entry.fromVersion === entry.toVersion && !entry.teamBefore);
        const counts = [
          entry.recordChanges.length && `${entry.recordChanges.length} values updated`,
          entry.createdRecordIds?.length && `${entry.createdRecordIds.length} records added`,
          entry.replacedRecords?.length && `${entry.replacedRecords.length} records edited`,
          entry.removedRecords?.length && `${entry.removedRecords.length} records deleted`,
        ].filter(Boolean);
        return (
          <li key={entry.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground">
              <ClockCounterClockwiseIcon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px] font-medium">{entry.title}</h2>
                <span className="font-mono text-[11.5px] text-muted-foreground tabular">
                  v{entry.fromVersion} → v{entry.toVersion}
                </span>
                {entry.undoneAt ? (
                  <span className="text-[12px] text-muted-foreground">Undone</span>
                ) : isCurrent ? (
                  <span className="text-[12px] text-primary">Current</span>
                ) : null}
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">“{entry.request}”</p>
              <ul className="mt-2 flex flex-col gap-1 text-[12.5px]">
                {entry.steps.map((step) => (
                  <li key={step.label} className="flex gap-2">
                    <span className={step.kind === "remove" ? "text-destructive" : "text-muted-foreground"}>
                      {step.kind === "add" ? "Added" : step.kind === "remove" ? "Removed" : "Changed"}
                    </span>
                    <span>{step.label}</span>
                    <span className="text-muted-foreground tabular">{step.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {[formatDateTime(entry.appliedAt), ...counts].join(" · ")}
              </p>
            </div>
            {isCurrent && mayUndo ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  undo(ws.id, entry.id);
                  markFresh([
                    ...new Set([
                      ...entry.recordChanges.map((c) => c.recordId),
                      ...(entry.removedRecords ?? []).map((r) => r.id),
                      ...(entry.replacedRecords ?? []).map((r) => r.id),
                    ]),
                  ]);
                }}
              >
                <ArrowCounterClockwiseIcon data-icon="inline-start" />
                Undo
              </Button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
