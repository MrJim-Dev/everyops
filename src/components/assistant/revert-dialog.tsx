"use client";

import {
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ClockCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { useRef } from "react";
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
import { formatTime } from "@/lib/format";
import type { ChangeEntry } from "@/lib/store/workspace-model";
import { cn } from "@/lib/utils";
import type { RevertPreview } from "./use-assistant-chat";

const plural = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

/** The changes a revert touches, newest first, with what each one did and when. */
function ChangeList({ changes, blocked }: { changes: ChangeEntry[]; blocked?: boolean }) {
  const Icon = blocked ? ClockCounterClockwiseIcon : ArrowUUpLeftIcon;
  return (
    <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border bg-background/40">
      {changes.map((c) => {
        const steps = c.steps.map((s) => s.label).filter(Boolean);
        return (
          <li key={c.id} className="flex items-center gap-2.5 px-3 py-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md border bg-card",
                blocked ? "text-warning" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] text-foreground">{c.title}</span>
              {steps.length ? (
                <span className="truncate text-[11.5px] text-muted-foreground">{steps.join(" · ")}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
              {formatTime(c.appliedAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Confirms reverting a conversation from one message on: lists exactly what will be undone, or explains what's
 * in the way (a newer change made elsewhere, or a change only owners and admins can undo).
 */
export function RevertDialog({
  preview,
  message,
  onClose,
  onConfirm,
  onOpenHistory,
}: {
  /** Open while set. */
  preview: RevertPreview | null;
  /** The message the revert starts from. */
  message: string;
  onClose: () => void;
  onConfirm: () => void;
  onOpenHistory: () => void;
}) {
  // Keep the content while the dialog animates out.
  const last = useRef({ preview, message });
  if (preview) last.current = { preview, message };
  const shown = preview ?? last.current.preview;
  const said = (preview ? message : last.current.message).trim();
  const quote = said.length > 60 ? `${said.slice(0, 57).trimEnd()}…` : said;
  if (!shown) return null;

  return (
    <AlertDialog open={!!preview} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="gap-4 sm:max-w-[440px]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {shown.kind === "ready"
              ? `Revert ${plural(shown.changes.length)}?`
              : shown.kind === "blocked"
                ? "A newer change is in the way"
                : "Only owners and admins can revert this"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">
            {shown.kind === "ready" ? (
              <>
                Everything the assistant changed {quote ? <>from “{quote}” on</> : "from this message on"} is
                undone, newest first. The conversation stays, and each plan is marked undone.
              </>
            ) : shown.kind === "blocked" ? (
              <>
                {shown.blocking.length === 1 ? "This change was" : "These changes were"} made afterwards,
                outside this conversation. Undo {shown.blocking.length === 1 ? "it" : "them"} in History
                first, then revert here.
              </>
            ) : (
              "Some of these changes are to the design or the team. Ask an owner or admin to revert them."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ChangeList
          changes={shown.kind === "blocked" ? shown.blocking : shown.changes}
          blocked={shown.kind === "blocked"}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{shown.kind === "ready" ? "Cancel" : "Close"}</AlertDialogCancel>
          {shown.kind === "ready" ? (
            <AlertDialogAction variant="destructive" onClick={onConfirm}>
              <ArrowCounterClockwiseIcon data-icon="inline-start" />
              Revert {plural(shown.changes.length)}
            </AlertDialogAction>
          ) : shown.kind === "blocked" ? (
            <AlertDialogAction onClick={onOpenHistory}>
              <ClockCounterClockwiseIcon data-icon="inline-start" />
              Open History
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
