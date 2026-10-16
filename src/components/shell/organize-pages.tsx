"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SystemIcon } from "@/components/system-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { System } from "@/lib/blueprint/types";
import type { ChangeOp } from "@/lib/engine/changes";
import { useWorkspaces } from "@/lib/store/workspaces";

const MAX = 40;

/**
 * Names a sidebar group for each page, saved as one change the owner can undo from History. Typing a group another
 * page already has puts them together; leaving it empty lists the page on its own.
 */
export function OrganizePagesDialog({
  open,
  onOpenChange,
  pages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: System[];
}) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const [groups, setGroups] = useState<Record<string, string>>({});
  const groupOf = (p: System) => groups[p.id] ?? p.group ?? "";
  const named = [...new Set(pages.map((p) => groupOf(p).trim()).filter(Boolean))];
  const tooLong = pages.some((p) => groupOf(p).trim().length > MAX);

  const close = (next: boolean) => {
    if (!next) setGroups({});
    onOpenChange(next);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (tooLong) return;
    const changed = pages.filter((p) => groupOf(p).trim() !== (p.group ?? ""));
    if (changed.length) {
      const ops: ChangeOp[] = changed.map((p) => ({ op: "group_system", systemId: p.id, group: groupOf(p) }));
      const names = (g: string) =>
        changed
          .filter((p) => groupOf(p).trim() === g)
          .map((p) => p.name)
          .join(", ");
      const entry = applyChange(ws.id, {
        request: "Organize the sidebar pages",
        title: "Organize pages",
        facts: [],
        steps: [...new Set(changed.map((p) => groupOf(p).trim()))].map((g) => ({
          kind: "change" as const,
          label: g || "On their own",
          detail: names(g),
        })),
        ops,
      });
      if (entry)
        toast.success("Pages organized", {
          description: "You can also undo it from History.",
          action: { label: "Undo", onClick: () => undoChange(ws.id, entry.id) },
        });
    }
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Organize pages</DialogTitle>
            <DialogDescription>
              Put pages under groups like Front desk or Money. Groups open and close in the sidebar, so a long
              list stays short.
            </DialogDescription>
          </DialogHeader>
          <datalist id="page-groups">
            {named.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <div className="-mx-1 flex max-h-[min(60vh,420px)] flex-col gap-1.5 overflow-y-auto px-1 py-0.5">
            {pages.map((p) => {
              const value = groupOf(p);
              return (
                <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-3">
                  <label
                    htmlFor={`group-${p.id}`}
                    className="flex min-w-0 items-center gap-2 text-[13px] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                  >
                    <SystemIcon name={p.icon} />
                    <span className="truncate">{p.name}</span>
                  </label>
                  <Input
                    id={`group-${p.id}`}
                    list="page-groups"
                    placeholder="No group"
                    autoComplete="off"
                    aria-invalid={value.trim().length > MAX ? true : undefined}
                    value={value}
                    onChange={(e) => setGroups((g) => ({ ...g, [p.id]: e.target.value }))}
                    className="h-8 text-[13px]"
                  />
                </div>
              );
            })}
          </div>
          {tooLong ? (
            <p className="text-[12.5px] text-destructive">Group names can be up to {MAX} characters.</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={tooLong}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
