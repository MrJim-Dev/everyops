"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { statusField } from "@/lib/blueprint/field-kind";
import { getEntity, recordTitle } from "@/lib/blueprint/lookup";
import type { RecordData } from "@/lib/blueprint/types";
import { findDuplicates } from "@/lib/engine/duplicates";
import type { FieldError } from "@/lib/engine/records";
import { RecordFieldsForm } from "./record-fields-form";

export function RecordFormDialog({
  entityId,
  prefill,
  onClose,
  onCreated,
}: {
  entityId: string;
  prefill: RecordData;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { blueprint, records } = useWorkspace();
  const actions = useRecordActions();
  const entity = getEntity(blueprint, entityId);
  const status = statusField(entity);
  const [values, setValues] = useState<RecordData>(() => ({
    ...(status?.options?.[0] ? { [status.id]: status.options[0].id } : {}),
    ...prefill,
  }));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const general = errors.filter((e) => !e.fieldId);
  // Someone already here with this phone or email: offer them instead of a second record.
  const twins = useMemo(() => findDuplicates(entity, values, records), [entity, values, records]);
  const twin = twins[0];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Dialogs can nest (e.g. "New customer" inside "New booking"); React events bubble
    // through portals, so keep this submit from reaching the outer form.
    event.stopPropagation();
    const result = actions.create(entityId, values);
    if (result.ok) onCreated(result.record.id);
    else setErrors(result.errors);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New {entity.name.toLowerCase()}</DialogTitle>
            <DialogDescription>Fields marked * are required.</DialogDescription>
          </DialogHeader>
          <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
            <RecordFieldsForm
              entity={entity}
              values={values}
              errors={errors}
              idPrefix="new"
              onChange={(fieldId, value) => {
                setValues((v) => ({ ...v, [fieldId]: value }));
                setErrors((list) => list.filter((e) => e.fieldId !== fieldId));
              }}
            />
          </div>
          {general.length ? (
            <p role="alert" className="text-[13px] text-destructive">
              {general[0].message}
            </p>
          ) : null}
          {twin ? (
            <div
              aria-live="polite"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12.5px]"
            >
              <span>
                <span className="font-medium">{recordTitle(entity, twin.record)}</span> already has this{" "}
                {twin.field.name.toLowerCase()}
                {twins.length > 1 ? ` (and ${twins.length - 1} more)` : ""}.
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => onCreated(twin.record.id)}>
                Use {recordTitle(entity, twin.record)} instead
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create {entity.name.toLowerCase()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
