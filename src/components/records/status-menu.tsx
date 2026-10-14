"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { optionOf } from "@/lib/blueprint/lookup";
import type { DataRecord, Field } from "@/lib/blueprint/types";
import { canEdit } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

/**
 * A status badge that changes the record's status in place: click it, pick another status.
 * Falls back to the plain badge for people who can't edit. Events stop here so the row or card
 * underneath doesn't open.
 */
export function StatusMenu({
  record,
  field,
  pill,
  className,
}: {
  record: DataRecord;
  field: Field;
  /** The bordered style used in a record's header. */
  pill?: boolean;
  className?: string;
}) {
  const ws = useWorkspace();
  const actions = useRecordActions();
  const current = optionOf(field, record.data[field.id]);
  const options = field.options ?? [];
  const badge = current ? (
    <StatusBadge label={current.label} tone={current.tone} className={pill ? "text-[12px]" : className} />
  ) : (
    <span className="text-muted-foreground/60">Set {field.name.toLowerCase()}</span>
  );

  if (!canEdit(ws.role) || field.type !== "status" || options.length < 2)
    return pill ? (
      <span className="inline-flex h-6 items-center rounded-full border px-2.5">{badge}</span>
    ) : (
      badge
    );

  const choose = (value: unknown) => {
    if (typeof value !== "string" || value === current?.id) return;
    const result = actions.update(record.id, { [field.id]: value });
    if (!result.ok) toast.error(result.errors[0]?.message ?? "That status couldn't be saved.");
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops clicks from reaching the row underneath
    <span
      className="relative z-10 inline-flex"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${field.name}: ${current?.label ?? "not set"}. Change`}
          className={cn(
            "group/status inline-flex items-center gap-1 rounded-full outline-none transition-[background-color,transform] duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] data-popup-open:bg-muted",
            pill ? "h-6 border px-2.5" : "-mx-1.5 h-6 px-1.5",
          )}
        >
          <span key={current?.id} className={pill ? "animate-pop" : undefined}>
            {badge}
          </span>
          <CaretDownIcon className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover/status:opacity-100 group-focus-visible/status:opacity-100 group-data-popup-open/status:opacity-100" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-auto min-w-40">
          <DropdownMenuRadioGroup value={current?.id ?? ""} onValueChange={choose}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={o.id} closeOnClick>
                <StatusBadge label={o.label} tone={o.tone} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
