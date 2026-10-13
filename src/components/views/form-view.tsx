"use client";

import { CheckCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { RecordFieldsForm } from "@/components/records/record-fields-form";
import { useRecordPanels } from "@/components/records/record-panels";
import { Button } from "@/components/ui/button";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { statusField } from "@/lib/blueprint/field-kind";
import { findRecord, getEntity, recordTitle } from "@/lib/blueprint/lookup";
import type { FormView as FormViewConfig, RecordData } from "@/lib/blueprint/types";
import type { FieldError } from "@/lib/engine/records";
import { canEdit } from "@/lib/store/workspaces";

/** A page that is one form, e.g. the front desk's booking form. Saving runs the same checks as everywhere else. */
export function FormView({ view }: { view: FormViewConfig }) {
  const ws = useWorkspace();
  const { openRecord } = useRecordPanels();
  const actions = useRecordActions();
  const entity = getEntity(ws.blueprint, view.entityId);
  const status = statusField(entity);
  const blank = (): RecordData => (status?.options?.[0] ? { [status.id]: status.options[0].id } : {});
  const [values, setValues] = useState<RecordData>(blank);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const general = errors.filter((e) => !e.fieldId);
  const created = createdId ? findRecord(ws.records, createdId) : undefined;
  const noun = entity.name.toLowerCase();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = actions.create(entity.id, values);
    if (result.ok) {
      setCreatedId(result.record.id);
      setErrors([]);
    } else setErrors(result.errors);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[560px] px-5 py-8">
        {created ? (
          <div className="flex animate-rise flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center">
            <CheckCircleIcon weight="fill" className="size-8 text-primary" />
            <h2 className="text-[16px] font-semibold">{entity.name} saved</h2>
            <p className="text-[13px] text-muted-foreground">{recordTitle(entity, created)}</p>
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => {
                  setCreatedId(null);
                  setValues(blank());
                  setRound((n) => n + 1);
                }}
              >
                Add another
              </Button>
              <Button variant="outline" onClick={() => openRecord(created.id)}>
                Open {noun}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5 rounded-lg border p-5 md:p-6">
            <div className="flex flex-col gap-1">
              <h2 className="text-[16px] font-semibold">{view.name}</h2>
              <p className="text-[13px] text-muted-foreground">
                {view.intro ?? `Fill in the details to add a ${noun}. Fields marked * are required.`}
              </p>
            </div>
            <RecordFieldsForm
              key={round}
              entity={entity}
              values={values}
              errors={errors}
              idPrefix={`form-${view.id}`}
              fieldIds={view.fieldIds}
              onChange={(fieldId, value) => {
                setValues((v) => ({ ...v, [fieldId]: value }));
                setErrors((list) => list.filter((e) => e.fieldId !== fieldId));
              }}
            />
            {general.length ? (
              <p role="alert" className="text-[13px] text-destructive">
                {general[0].message}
              </p>
            ) : null}
            {canEdit(ws.role) ? (
              <Button type="submit" className="self-start">
                {view.submitLabel ?? `Save ${noun}`}
              </Button>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                You have view-only access to this workspace.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
