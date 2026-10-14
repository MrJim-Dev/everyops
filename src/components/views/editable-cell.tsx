"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FieldInput } from "@/components/records/field-input";
import { FieldValue as FieldValueView } from "@/components/records/field-value";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import type { DataRecord, Field, FieldValue } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";

/** Field types that can be edited right inside a table cell. */
const INLINE = new Set<Field["type"]>([
  "text",
  "long_text",
  "number",
  "percent",
  "money",
  "date",
  "datetime",
  "select",
  "checkbox",
]);

export function canEditInline(field: Field) {
  return INLINE.has(field.type) && !field.formula && !field.rollup;
}

/**
 * A table cell you can click to edit. Enter or clicking away saves, Escape cancels. Saving goes
 * through the same record update as the record panel, so validation and rules still apply.
 */
export function EditableCell({ record, field }: { record: DataRecord; field: Field }) {
  const { update } = useRecordActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FieldValue | undefined>(undefined);
  const value = record.data[field.id];
  const label = `Edit ${field.name}`;
  const box = useRef<HTMLDivElement>(null);

  // Focus the input as soon as the cell turns into one, with its text selected.
  useLayoutEffect(() => {
    if (!editing) return;
    const input = box.current?.querySelector<HTMLInputElement>("input, textarea");
    input?.focus();
    input?.select?.();
  }, [editing]);

  const save = (next: FieldValue | undefined) => {
    setEditing(false);
    if (JSON.stringify(next ?? null) === JSON.stringify(value ?? null)) return;
    const result = update(record.id, { [field.id]: next ?? null });
    if (!result.ok)
      toast.error(`Couldn't save ${field.name.toLowerCase()}`, { description: result.errors[0]?.message });
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
          onOpenChange={(open) => !open && setEditing(false)}
          items={Object.fromEntries((field.options ?? []).map((o) => [o.id, o.label]))}
        >
          <SelectTrigger size="sm" aria-label={label} className="-my-1 h-7 min-w-[120px] text-[13px]">
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

  if (editing) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: wraps the input so typing and clicks stay in the cell
      <div
        ref={box}
        className="-my-1 min-w-[120px] [&_input]:h-7 [&_input]:text-[13px] [&_textarea]:min-h-0 [&_textarea]:text-[13px] [&_button]:h-7"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save(draft);
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save(draft);
        }}
      >
        <FieldInput
          id={`${record.id}-${field.id}`}
          field={field.type === "long_text" ? { ...field, type: "text" } : field}
          value={draft}
          onChange={setDraft}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.stopPropagation();
      }}
      className={cn(
        "-mx-1.5 block w-[calc(100%+12px)] cursor-text truncate rounded-sm px-1.5 py-0.5 text-inherit outline-none transition-colors duration-150 [text-align:inherit]",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {value === null || value === undefined || value === "" ? (
        <span className="text-muted-foreground/60">Empty</span>
      ) : (
        <FieldValueView field={field} value={value} />
      )}
    </button>
  );
}
