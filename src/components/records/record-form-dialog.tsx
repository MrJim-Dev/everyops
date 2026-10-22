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
import { getEntity } from "@/lib/blueprint/lookup";
import type { RecordData } from "@/lib/blueprint/types";
import type { FieldError } from "@/lib/engine/records";
import { dayOfValue, planSeries, seriesField } from "@/lib/engine/recurrence";
import { RecordFieldsForm } from "./record-fields-form";
import { NO_REPEAT, type RepeatChoice, RepeatPicker, toRepeat } from "./repeat-picker";

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
  const { blueprint, data } = useWorkspace();
  const actions = useRecordActions();
  const entity = getEntity(blueprint, entityId);
  const status = statusField(entity);
  const [values, setValues] = useState<RecordData>(() => ({
    ...(status?.options?.[0] ? { [status.id]: status.options[0].id } : {}),
    ...prefill,
  }));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const general = errors.filter((e) => !e.fieldId);
  // Records with a date can repeat: a booking every Tuesday, a fee every month.
  const dateField = seriesField(entity);
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>(NO_REPEAT);
  const repeat = useMemo(() => toRepeat(repeatChoice), [repeatChoice]);
  const firstDay = dateField ? dayOfValue(values[dateField]) : null;
  const plan = useMemo(
    () => (repeat && firstDay ? planSeries(data, entityId, values, repeat) : []),
    [repeat, firstDay, data, entityId, values],
  );
  const count = plan.filter((i) => !i.clash).length;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Dialogs can nest (e.g. "New customer" inside "New booking"); React events bubble
    // through portals, so keep this submit from reaching the outer form.
    event.stopPropagation();
    const result = repeat
      ? actions.createSeries(entityId, values, repeat, {
          one: entity.name.toLowerCase(),
          many: entity.pluralName.toLowerCase(),
        })
      : actions.create(entityId, values);
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
            {dateField ? (
              <div className="mt-4">
                <RepeatPicker
                  entity={entity}
                  value={repeatChoice}
                  onChange={setRepeatChoice}
                  firstDay={firstDay}
                  plan={plan}
                />
              </div>
            ) : null}
          </div>
          {general.length ? (
            <p role="alert" className="text-[13px] text-destructive">
              {general[0].message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {repeat && count > 1
                ? `Create ${count} ${entity.pluralName.toLowerCase()}`
                : `Create ${entity.name.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
