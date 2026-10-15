"use client";

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  ClockCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ViewEmpty } from "@/components/views/view-empty";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatTime } from "@/lib/format";
import { markFresh } from "@/lib/motion/fresh";
import { canRedo } from "@/lib/store/apply-plan";
import type { ChangeEntry, Workspace } from "@/lib/store/workspace-model";
import { canEdit, canManage, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { groupHistory } from "./history-groups";

const records = (n: number) => `${n} ${n === 1 ? "record" : "records"}`;

type RowProps = {
  entry: ChangeEntry;
  current: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
};

/** One change: what was asked, what it did, when, and the way back (Undo on the latest, Redo on undone ones). */
function ChangeRow({ entry, current, onUndo, onRedo }: RowProps) {
  const undone = !!entry.undoneAt;
  const counts = [
    entry.recordChanges.length && `${entry.recordChanges.length} values updated`,
    entry.createdRecordIds?.length && `${records(entry.createdRecordIds.length)} added`,
    entry.replacedRecords?.length && `${records(entry.replacedRecords.length)} edited`,
    entry.removedRecords?.length && `${records(entry.removedRecords.length)} deleted`,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border",
          current ? "border-primary/35 bg-primary/10 text-primary" : "text-muted-foreground",
        )}
      >
        {undone ? (
          <ArrowCounterClockwiseIcon className="size-3.5" />
        ) : (
          <ClockCounterClockwiseIcon className="size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn("text-[14px] font-medium", undone && "text-muted-foreground")}>{entry.title}</h3>
          {current ? (
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11.5px] text-primary">Current</span>
          ) : undone ? (
            <span className="rounded-full border px-2 py-0.5 text-[11.5px] text-muted-foreground">
              Undone
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">“{entry.request}”</p>
        {entry.steps.length ? (
          <ul className={cn("mt-2 flex flex-col gap-1 text-[12.5px]", undone && "opacity-70")}>
            {entry.steps.map((step, i) => (
              // Two steps can share a label ("Bookings" changed twice), so they're keyed by position.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list per change
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className={step.kind === "remove" ? "text-destructive" : "text-muted-foreground"}>
                  {step.kind === "add" ? "Added" : step.kind === "remove" ? "Removed" : "Changed"}
                </span>
                <span>{step.label}</span>
                {step.detail ? <span className="text-muted-foreground">{step.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[12px] text-muted-foreground tabular-nums">
          {[
            formatTime(entry.appliedAt),
            entry.auto
              ? `applied automatically by Ask EveryOps${entry.appliedBy ? ` for ${entry.appliedBy}` : ""}`
              : entry.appliedBy
                ? `by ${entry.appliedBy}`
                : null,
            ...counts,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>
      </div>
      {onUndo ? (
        <Button variant="outline" size="sm" onClick={onUndo}>
          <ArrowCounterClockwiseIcon data-icon="inline-start" />
          Undo
        </Button>
      ) : onRedo ? (
        <Button variant="outline" size="sm" onClick={onRedo}>
          <ArrowClockwiseIcon data-icon="inline-start" />
          Redo
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Attempts that were tried and undone in a row ("make a landing page", three times), folded into one line so the
 * changes that stuck stay readable. Opening it shows each attempt, with Redo where it still applies.
 */
function UndoneRun({
  entries,
  row,
}: {
  entries: ChangeEntry[];
  row: (entry: ChangeEntry) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const oldest = entries.at(-1) as ChangeEntry;
  const span =
    formatTime(oldest.appliedAt) === formatTime(entries[0].appliedAt)
      ? formatTime(entries[0].appliedAt)
      : `${formatTime(oldest.appliedAt)} to ${formatTime(entries[0].appliedAt)}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left outline-none transition-colors duration-150 hover:bg-muted/30 focus-visible:bg-muted/30"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
          <ArrowCounterClockwiseIcon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">
          <span className="font-medium text-foreground">{entries.length} undone attempts</span>{" "}
          {entries[0].title}
          {entries.length > 1 ? ` and ${entries.length - 1} more` : ""}
        </span>
        <span className="hidden shrink-0 text-[12px] text-muted-foreground tabular-nums sm:inline">
          {span}
        </span>
        <CaretDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open && "rotate-180",
          )}
        />
      </button>
      {/* Grid rows animate the height without measuring it, like the FAQ on public pages. */}
      <div
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-(--ease-out-strong)",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <ol className="divide-y border-t border-dashed bg-muted/[0.15]">{entries.map(row)}</ol>
        </div>
      </div>
    </li>
  );
}

/** Whether this change is the one Undo applies to: changes are undone newest first. */
function isCurrent(workspace: Workspace, entry: ChangeEntry) {
  const at = workspace.changes.indexOf(entry);
  return (
    !entry.undoneAt &&
    workspace.currentVersion === entry.toVersion &&
    workspace.changes.slice(0, at).every((c) => c.undoneAt)
  );
}

export function HistoryList() {
  const ws = useWorkspace();
  const workspace = useWorkspaces((s) => s.workspaces[ws.id]);
  const undo = useWorkspaces((s) => s.undoChange);
  const redo = useWorkspaces((s) => s.redoChange);
  const [confirming, setConfirming] = useState<ChangeEntry | null>(null);
  const changes = workspace?.changes ?? [];

  if (!workspace || changes.length === 0) {
    return (
      <ViewEmpty
        title="No changes yet"
        description="When you ask EveryOps to change this workspace, each change appears here and can be undone."
      />
    );
  }

  const runUndo = (entry: ChangeEntry) => {
    undo(ws.id, entry.id);
    markFresh([
      ...new Set([
        ...entry.recordChanges.map((c) => c.recordId),
        ...(entry.removedRecords ?? []).map((r) => r.id),
        ...(entry.replacedRecords ?? []).map((r) => r.id),
      ]),
    ]);
  };
  const row = (entry: ChangeEntry) => {
    const current = isCurrent(workspace, entry);
    // Staff can undo the data changes they're allowed to make; owners and admins anything.
    const mayUndo =
      canManage(ws.role) || (canEdit(ws.role) && entry.fromVersion === entry.toVersion && !entry.teamBefore);
    return (
      <ChangeRow
        key={entry.id}
        entry={entry}
        current={current}
        onUndo={current && mayUndo ? () => setConfirming(entry) : undefined}
        onRedo={canManage(ws.role) && canRedo(workspace, entry.id) ? () => redo(ws.id, entry.id) : undefined}
      />
    );
  };

  return (
    <>
      {groupHistory(changes).map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h2 className="sticky top-0 z-10 border-b bg-background/90 px-5 py-2 text-[12px] font-medium text-muted-foreground backdrop-blur">
            {day.label}
          </h2>
          <ol className="divide-y border-b">
            {day.items.map((item) =>
              item.kind === "run" ? (
                <UndoneRun key={item.entries[0].id} entries={item.entries} row={row} />
              ) : (
                row(item.entry)
              ),
            )}
          </ol>
        </section>
      ))}
      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo “{confirming?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && confirming.fromVersion !== confirming.toVersion
                ? "The workspace goes back to how it was before this change. You can redo it from here afterwards."
                : "The records it added, edited or deleted go back to how they were."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) runUndo(confirming);
                setConfirming(null);
              }}
            >
              Undo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
