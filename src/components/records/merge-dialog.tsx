"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity } from "@/lib/blueprint/types";
import { linksTo, mergeInto } from "@/lib/engine/duplicates";
import { formatDateTime } from "@/lib/format";
import { markFresh } from "@/lib/motion/fresh";
import { useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { FieldValue } from "./field-value";

/**
 * Merging two records of a type (src/lib/engine/duplicates.ts): pick the one to keep; its empty fields take the
 * other's values, everything linked to the other moves to it, and the other is removed. A live workspace merges on the
 * server, over every record, so links the browser hasn't loaded move too.
 */
export function MergeDialog({
  entity,
  records: pair,
  onClose,
  onMerged,
}: {
  entity: Entity;
  records: [DataRecord, DataRecord];
  onClose: () => void;
  onMerged: (keptId: string) => void;
}) {
  const ws = useWorkspace();
  const [keepId, setKeepId] = useState(pair[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = pair.find((r) => r.id === keepId) ?? pair[0];
  const drop = pair.find((r) => r.id !== keepId) ?? pair[1];
  const shown = entity.fields.filter((f) => f.id !== entity.primaryFieldId).slice(0, 5);
  const linked = [...new Set(linksTo(ws.data, entity.id).map((l) => l.entity.pluralName.toLowerCase()))];
  const noun = entity.name.toLowerCase();

  const merge = async () => {
    setBusy(true);
    setError(null);
    if (ws.mode === "live") {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(ws.id)}/records/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keepId: keep.id, dropId: drop.id }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        notices?: string[];
      } | null;
      if (!res?.ok || !body?.ok) {
        setBusy(false);
        setError(body?.message ?? "Couldn't merge. Try again.");
        return;
      }
      await useWorkspaces.getState().refresh(ws.id);
      markFresh([keep.id]);
      toast.success(`Merged into ${recordTitle(entity, keep)}`, {
        description: body.notices?.join(" ") || undefined,
      });
    } else {
      const done = mergeInto(ws.data, keep.id, drop.id);
      if (!done.ok) {
        setBusy(false);
        setError(done.message);
        return;
      }
      const before = ws.data;
      ws.commit(done.data);
      markFresh([keep.id]);
      toast.success(`Merged into ${recordTitle(entity, keep)}`, {
        action: { label: "Undo", onClick: () => ws.commit(before) },
      });
    }
    onMerged(keep.id);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Merge duplicate {entity.pluralName.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Choose the {noun} to keep. The other is removed once its details are copied over.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">{entity.name} to keep</legend>
          {pair.map((r) => {
            const kept = r.id === keep.id;
            return (
              <label
                key={r.id}
                className={cn(
                  "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  kept ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="merge-keep"
                  className="sr-only"
                  checked={kept}
                  onChange={() => setKeepId(r.id)}
                />
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-medium">{recordTitle(entity, r)}</span>
                  <span className={cn("text-[11.5px]", kept ? "text-primary" : "text-muted-foreground")}>
                    {kept ? "Keep" : "Remove"}
                  </span>
                </span>
                <dl className="grid grid-cols-[minmax(72px,40%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
                  {shown.map((f) => (
                    <div key={f.id} className="contents">
                      <dt className="text-muted-foreground">{f.name}</dt>
                      <dd className="min-w-0 truncate">
                        <FieldValue field={f} value={r.data[f.id]} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <span className="text-[11.5px] text-muted-foreground">
                  Added {formatDateTime(r.createdAt)}
                </span>
              </label>
            );
          })}
        </fieldset>
        <p className="text-[12.5px] text-muted-foreground">
          {recordTitle(entity, drop)}'s {linked.length ? linked.join(" and ") : "links"} move to{" "}
          {recordTitle(entity, keep)}. Details {recordTitle(entity, keep)} is missing are copied from the
          other record.{ws.mode === "live" ? " This can't be undone." : ""}
        </p>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void merge()} disabled={busy}>
            {busy ? "Merging…" : `Merge into ${recordTitle(entity, keep)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
