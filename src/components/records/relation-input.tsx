"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { findEntity, recordsOf, recordTitle } from "@/lib/blueprint/lookup";
import type { Field } from "@/lib/blueprint/types";
import { RecordFormDialog } from "./record-form-dialog";

/**
 * Pick a linked record, or create one on the spot. Without the "+" a new
 * workspace couldn't save its first booking, because no customers exist yet.
 * (Forms can nest: the create dialog renders this input again for its own links.)
 */
export function RelationInput({
  id,
  field,
  value,
  onChange,
  invalid,
}: {
  id: string;
  field: Field;
  value: string | null;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const { blueprint, records } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const target = field.relation ? findEntity(blueprint, field.relation.entityId) : undefined;
  if (!target) return null;
  const options = recordsOf(records, target.id)
    .map((r) => ({ id: r.id, label: recordTitle(target, r) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const placeholder = options.length
    ? `Choose ${field.name.toLowerCase()}`
    : `No ${target.pluralName.toLowerCase()} yet`;

  return (
    <div className="flex gap-2">
      <Select
        value={value}
        onValueChange={(v) => onChange(v as string)}
        items={Object.fromEntries(options.map((o) => [o.id, o.label]))}
      >
        <SelectTrigger id={id} aria-invalid={invalid || undefined} className="min-w-0 flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`New ${target.name.toLowerCase()}`}
        onClick={() => setCreating(true)}
      >
        <PlusIcon />
      </Button>
      {creating ? (
        <RecordFormDialog
          entityId={target.id}
          prefill={{}}
          onClose={() => setCreating(false)}
          onCreated={(newId) => {
            onChange(newId);
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}
