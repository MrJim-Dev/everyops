"use client";

import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FieldInput } from "@/components/records/field-input";
import { FieldValue as FieldValueView } from "@/components/records/field-value";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { DataRecord, Field, FieldValue } from "@/lib/blueprint/types";
import { valueText } from "@/lib/engine/value-text";
import { cn } from "@/lib/utils";

/** Field types that can be edited right inside a table cell. */
const INLINE = new Set<Field["type"]>([
  "text",
  "email",
  "phone",
  "url",
  "long_text",
  "number",
  "percent",
  "money",
  "rating",
  "duration",
  "date",
  "datetime",
  "select",
  "checkbox",
]);
/** Types where typing on a selected cell starts editing with that character, like a spreadsheet. */
const TYPE_TO_EDIT = new Set<Field["type"]>([
  "text",
  "long_text",
  "number",
  "percent",
  "money",
  "duration",
  "email",
  "phone",
  "url",
]);

export function canEditInline(field: Field) {
  return INLINE.has(field.type) && !field.formula && !field.rollup;
}

/**
 * A table cell you can edit in place, like Supabase. Click selects it; double-click, Enter or just
 * typing opens a small editor over the cell. Enter or Save saves, Escape cancels, clicking away saves.
 * Saving goes through the same record update as the record panel, so validation and rules still apply.
 */
export function EditableCell({ record, field }: { record: DataRecord; field: Field }) {
  const { update } = useRecordActions();
  const { blueprint, records } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FieldValue | undefined>(undefined);
  const value = record.data[field.id];
  const cell = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLFormElement>(null);

  const save = (next: FieldValue | undefined) => {
    setEditing(false);
    if (JSON.stringify(next ?? null) === JSON.stringify(value ?? null)) return;
    const result = update(record.id, { [field.id]: next ?? null });
    if (!result.ok)
      toast.error(`Couldn't save ${field.name.toLowerCase()}`, { description: result.errors[0]?.message });
  };
  const start = (initial: FieldValue | undefined = value) => {
    setDraft(initial);
    setEditing(true);
  };

  // Checkboxes toggle in one click; there's nothing to type.
  if (field.type === "checkbox") {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: stops the row from opening; the checkbox is the control
      <span
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="inline-flex"
      >
        <FieldInput id={`${record.id}-${field.id}`} field={field} value={value} onChange={(v) => save(v)} />
      </span>
    );
  }

  // Choices open their list straight away; picking saves, closing without a pick cancels.
  if (editing && field.type === "select") {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening while choosing
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Select
          defaultOpen
          value={typeof value === "string" ? value : null}
          onValueChange={(v) => save(v as string)}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(false);
              cell.current?.focus();
            }
          }}
          items={Object.fromEntries((field.options ?? []).map((o) => [o.id, o.label]))}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Edit ${field.name}`}
            className="-my-1 h-7 min-w-[120px] text-[13px]"
          >
            <SelectValue placeholder={`Choose ${field.name.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(field.options ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </span>
    );
  }

  const empty = value === null || value === undefined || value === "";
  return (
    <Popover.Root
      open={editing}
      onOpenChange={(open, details) => {
        if (open) return;
        // Escape throws the edit away; clicking elsewhere keeps it, like a spreadsheet.
        if (details.reason === "escape-key") setEditing(false);
        else save(draft);
        cell.current?.focus();
      }}
    >
      <button
        ref={cell}
        type="button"
        // Read the way it shows ("1 h 15 min", "₱1,200", "Cash"), not as it's stored (75, 1200, "cash").
        aria-label={`${field.name}: ${empty ? "empty" : valueText(blueprint, records, field, value) || String(value)}. Double-click or press Enter to edit`}
        title="Double-click to edit"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          start();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "F2") {
            e.preventDefault();
            e.stopPropagation();
            start();
          } else if (
            e.key.length === 1 &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            TYPE_TO_EDIT.has(field.type)
          ) {
            e.preventDefault();
            start(e.key as FieldValue);
          }
        }}
        className={cn(
          "block w-full cursor-default truncate py-0.5 text-inherit outline-none select-none [text-align:inherit]",
          // Hover and selection cover the whole cell, edge to edge, like Supabase (the cell is `relative`).
          "after:pointer-events-none after:absolute after:inset-0 after:transition-[background-color,box-shadow] after:duration-100",
          "hover:after:bg-muted/40 focus:after:bg-primary/8 focus:after:shadow-[inset_0_0_0_1.5px_var(--primary)]",
          editing && "opacity-0",
        )}
      >
        {empty ? (
          <span className="text-muted-foreground/50">Empty</span>
        ) : (
          <FieldValueView field={field} value={value} />
        )}
      </button>
      <Popover.Portal>
        <Popover.Positioner
          // Lined up with the whole cell, not just its text.
          anchor={() => cell.current?.closest("td") ?? cell.current}
          side="bottom"
          align="start"
          sideOffset={({ anchor }) => -anchor.height}
          className="isolate z-50"
        >
          <Popover.Popup
            // The editor sits in a portal, but React still bubbles its events to the table row, which
            // opens the record on click or Enter. Keep them here.
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            initialFocus={() => {
              const input = box.current?.querySelector<HTMLInputElement>("input, textarea") ?? null;
              requestAnimationFrame(() => input?.select?.());
              return input;
            }}
            className={cn(
              "w-[max(var(--anchor-width),280px)] origin-(--transform-origin) rounded-[3px] bg-popover p-2 text-popover-foreground shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)] ring-[1.5px] ring-primary outline-none",
              "transition-[opacity,transform] duration-150 ease-(--ease-out-strong)",
              "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-100",
            )}
          >
            <form
              ref={box}
              onSubmit={(e) => {
                e.preventDefault();
                save(draft);
                cell.current?.focus();
              }}
              onKeyDown={(e) => {
                // Enter saves; Shift+Enter is a new line in long text.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.requestSubmit();
                }
              }}
              className="flex flex-col gap-2 [&_input]:h-8 [&_input]:text-[13px] [&_textarea]:text-[13px]"
            >
              <FieldInput
                id={`${record.id}-${field.id}-edit`}
                field={field}
                value={draft}
                onChange={setDraft}
              />
              <div className="flex items-center gap-1.5">
                <span className="mr-auto text-[11.5px] text-muted-foreground">
                  <Kbd>Esc</Kbd> to cancel
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    cell.current?.focus();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" size="xs">
                  Save <Kbd className="ml-0.5 bg-primary-foreground/15 text-primary-foreground">↵</Kbd>
                </Button>
              </div>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
