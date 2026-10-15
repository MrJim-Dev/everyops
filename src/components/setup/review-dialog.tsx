"use client";

import { CheckIcon, PencilSimpleIcon, SparkleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type CSSProperties, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { SetupDraft } from "@/lib/store/workspaces";

const step = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * Shown over the finished workspace when the design is done: what was built, then Create workspace or Make changes
 * (back to the setup chat, where the owner says what to change). Dismissing it counts as Make changes, so the owner
 * is never left on a screen with nothing to press.
 */
export function ReviewDialog({
  open,
  draft,
  onCreate,
  onChanges,
}: {
  open: boolean;
  draft: SetupDraft;
  onCreate: () => void;
  onChanges: () => void;
}) {
  const bp = draft.data.blueprint;
  const counts = [
    { label: bp.systems.length === 1 ? "page" : "pages", value: bp.systems.length },
    { label: bp.entities.length === 1 ? "record type" : "record types", value: bp.entities.length },
    {
      label: draft.data.records.length === 1 ? "sample record" : "sample records",
      value: draft.data.records.length,
    },
  ];
  const covered = draft.coverage ?? [];
  const gaps = draft.gaps ?? [];
  const createButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onChanges()}>
      <DialogContent showCloseButton={false} initialFocus={createButton} className="gap-0 p-0 sm:max-w-lg">
        <div className="flex max-h-[min(70vh,560px)] flex-col gap-5 overflow-y-auto p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 animate-pop items-center justify-center rounded-full bg-primary/15 text-primary [animation-delay:120ms] [animation-fill-mode:both]">
              <CheckIcon weight="bold" className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-[17px] font-semibold tracking-tight">
                {draft.name} is ready
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed">{draft.summary}</DialogDescription>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {counts.map((c, i) => (
              <div
                key={c.label}
                className="flex animate-rise flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5 stagger"
                style={step(i + 1)}
              >
                <span className="text-[18px] font-semibold tabular">{c.value}</span>
                <span className="text-[12px] text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>

          <ul className="flex flex-col divide-y rounded-lg border">
            {draft.preview.map((item, i) => (
              <li
                key={item.label}
                className="flex animate-rise gap-4 px-3.5 py-2.5 text-[13px] stagger"
                style={step(i + 4)}
              >
                <span className="w-28 shrink-0 font-medium">{item.label}</span>
                <span className="min-w-0 text-muted-foreground">{item.detail}</span>
              </li>
            ))}
          </ul>

          {gaps.length ? (
            <div
              className="flex animate-rise flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-[12.5px] stagger"
              style={step(draft.preview.length + 4)}
            >
              <p className="flex items-center gap-2 font-medium">
                <WarningCircleIcon className="size-4 shrink-0 text-amber-500" />
                {gaps.length === 1
                  ? "1 thing from your plan isn't in it yet"
                  : `${gaps.length} things from your plan aren't in it yet`}
              </p>
              <ul className="list-disc space-y-1 pl-10 text-muted-foreground">
                {gaps.slice(0, 5).map((gap) => (
                  <li key={gap.request}>{gap.request}</li>
                ))}
              </ul>
              <p className="pl-6 text-muted-foreground">
                Create the workspace, then ask EveryOps to add them.
              </p>
            </div>
          ) : covered.length ? (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <CheckIcon weight="bold" className="size-3.5 text-primary" />
              Checked against all {covered.length} things you asked for
            </p>
          ) : null}
        </div>
        <DialogFooter className="mx-0 mb-0 px-5 py-3">
          <Button variant="outline" onClick={onChanges}>
            <PencilSimpleIcon data-icon="inline-start" />
            Make changes
          </Button>
          <Button ref={createButton} onClick={onCreate}>
            <SparkleIcon data-icon="inline-start" />
            Create workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
