"use client";

import { ArrowsClockwiseIcon, TableIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatDateTime } from "@/lib/format";
import { canManage } from "@/lib/store/workspace-model";
import { useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

type Sync = {
  id: string;
  entityId: string;
  url: string;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastResult: {
    created: number;
    updated: number;
    unchanged: number;
    problems: number;
    message: string | null;
    examples?: string[];
  } | null;
};

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Above a table whose record type is kept in sync with a Google Sheet: where it comes from, how the last sync went,
 * and (owners and admins) Sync now and Stop syncing.
 */
export function SheetSyncBar({ entityId }: { entityId: string }) {
  const ws = useWorkspace();
  const manager = canManage(ws.role);
  const refresh = useWorkspaces((s) => s.refresh);
  const base = `/api/workspaces/${encodeURIComponent(ws.id)}/sheet-sync`;
  const [sync, setSync] = useState<Sync | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { syncs?: Sync[] } | null;
    setSync(body?.syncs?.find((s) => s.entityId === entityId) ?? null);
  }, [base, entityId]);
  useEffect(() => {
    if (ws.mode === "live") void load();
  }, [load, ws.mode]);
  if (!sync) return null;

  const r = sync.lastResult;
  const summary =
    sync.lastStatus === "error"
      ? (r?.message ?? "The last sync failed.")
      : r
        ? [
            n(r.created, "added", "added"),
            n(r.updated, "updated", "updated"),
            r.problems ? n(r.problems, "row with a problem", "rows with problems") : "",
          ]
            .filter(Boolean)
            .join(", ")
        : "Next sync within 15 minutes.";
  const run = async () => {
    setBusy(true);
    const res = await fetch(`${base}/${sync.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) toast.error("The sync didn't run. Try again.");
    // The sync wrote on the server: bring its rows into this tab now.
    else await refresh(ws.id);
    void load();
  };
  const stop = async () => {
    await fetch(`${base}/${sync.id}`, { method: "DELETE" }).catch(() => null);
    toast.success("Stopped syncing", { description: "The records it brought in stay." });
    void load();
  };

  return (
    <div
      className={cn(
        "mx-5 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[12.5px] sm:mx-6",
        sync.lastStatus === "error" ? "border-destructive/30 bg-destructive/[0.04]" : "bg-muted/20",
      )}
    >
      {sync.lastStatus === "error" ? (
        <WarningCircleIcon className="size-4 text-destructive" />
      ) : (
        <TableIcon className="size-4 text-success" />
      )}
      <span>
        Synced from{" "}
        <a href={sync.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          a Google Sheet
        </a>
      </span>
      <span className={cn("text-muted-foreground", sync.lastStatus === "error" && "text-destructive")}>
        {sync.lastRunAt && r ? `${formatDateTime(sync.lastRunAt)}: ` : ""}
        {summary}
      </span>
      {r?.examples?.length ? <span className="text-muted-foreground">({r.examples[0]})</span> : null}
      {manager ? (
        <span className="ml-auto flex gap-1">
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run()}>
            <ArrowsClockwiseIcon data-icon="inline-start" className={cn(busy && "animate-spin")} />
            Sync now
          </Button>
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => void stop()}>
            Stop syncing
          </Button>
        </span>
      ) : null}
    </div>
  );
}
