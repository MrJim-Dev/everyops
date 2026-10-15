"use client";

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

type Version = { id: number; savedAt: string; keptAt: string; bytes: number };
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} KB`;

/**
 * Earlier versions of a page's text (kept every few minutes while it's edited, and before every rewrite). Restoring
 * puts that text in the editor, which saves it like any edit, so the text it replaces is kept too.
 */
export function PageVersions({
  workspaceId,
  pageKey,
  current,
  onRestore,
}: {
  workspaceId: string;
  pageKey: string;
  current: string;
  onRestore: (body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/pages/versions?key=${encodeURIComponent(pageKey)}`;

  useEffect(() => {
    if (!open) return;
    let live = true;
    setVersions(null);
    fetch(base)
      .then((r) => r.json())
      .then((body: { ok: boolean; versions?: Version[] }) => live && setVersions(body.versions ?? []))
      .catch(() => live && setVersions([]));
    return () => {
      live = false;
    };
  }, [open, base]);

  const restore = async (v: Version) => {
    setBusy(v.id);
    try {
      const res = await fetch(`${base}&version=${v.id}`);
      const body = (await res.json()) as { ok: boolean; body?: string; message?: string };
      if (!body.ok || typeof body.body !== "string") throw new Error(body.message);
      const before = current;
      onRestore(body.body);
      setOpen(false);
      toast.success(`Restored the version from ${formatDateTime(v.savedAt)}`, {
        action: { label: "Undo", onClick: () => onRestore(before) },
      });
    } catch (error) {
      toast.error((error as Error).message || "Couldn't restore it");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <ClockCounterClockwiseIcon data-icon="inline-start" />
        Versions
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Earlier versions</DialogTitle>
            <DialogDescription>
              Kept every few minutes while the page is edited, and before it's rewritten. The last 20 stay.
            </DialogDescription>
          </DialogHeader>
          {versions === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : versions.length ? (
            <ul className="-mx-1 flex max-h-[50vh] flex-col overflow-y-auto">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 rounded-md px-1 py-2 hover:bg-muted/40">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13.5px]">{formatDateTime(v.savedAt)}</span>
                    <span className="text-[12px] text-muted-foreground">{kb(v.bytes)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void restore(v)}
                  >
                    {busy === v.id ? "Restoring…" : "Restore"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No earlier versions yet. They're kept as soon as this page changes.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
