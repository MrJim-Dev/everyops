"use client";

import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { ExtrasPicker } from "@/components/forms/extras-picker";
import { StepIndicator } from "@/components/forms/step-indicator";
import { PublicBlocks } from "@/components/public/public-blocks";
import { FieldValue } from "@/components/records/field-value";
import { RecordFieldsForm } from "@/components/records/record-fields-form";
import { useRecordPanels } from "@/components/records/record-panels";
import { Button } from "@/components/ui/button";
import { useRecordActions } from "@/components/workspace/use-record-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { statusField } from "@/lib/blueprint/field-kind";
import { formSteps, missingInStep, placeExtras, stepOfField } from "@/lib/blueprint/form-steps";
import { findRecord, getEntity, getField, recordTitle } from "@/lib/blueprint/lookup";
import type { FormView as FormViewConfig, RecordData } from "@/lib/blueprint/types";
import type { FieldError } from "@/lib/engine/records";
import { publicExtras, publicFieldsOf, resolveBlocks, submitButton } from "@/lib/public/resolve";
import { canEdit } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { PublicBar } from "./public-bar";

/**
 * A page that is one form, e.g. the front desk's booking form. With steps it asks a few fields at a time and can end
 * with a review. Saving runs the same checks as everywhere else.
 */
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
  const [step, setStep] = useState(0);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const general = errors.filter((e) => !e.fieldId);
  const created = createdId ? findRecord(ws.records, createdId) : undefined;
  const noun = entity.name.toLowerCase();
  const wizard = !!view.steps?.length;
  // Add-ons offered with the form (paddle rental, balls), on their own step or with the fields.
  const offered = useMemo(
    () => publicExtras(ws.blueprint, ws.records, view),
    [ws.blueprint, ws.records, view],
  );
  const steps = useMemo(
    () => placeExtras(formSteps(entity, view), offered?.title),
    [entity, view, offered?.title],
  );
  const picked = (offered?.items ?? []).filter((i) => (extras[i.id] ?? 0) > 0);
  const titles = [...steps.map((s) => s.title), ...(wizard && view.review ? ["Review"] : [])];
  const reviewing = wizard && step === steps.length;
  const last = step === titles.length - 1;
  const button = submitButton(view.submitLabel, `Save ${noun}`);
  // On a public form, say which fields the team fills in that visitors never see.
  const hiddenFromVisitors = useMemo(() => {
    if (!view.public) return [];
    const shown = new Set(publicFieldsOf(ws.blueprint, view).map((f) => f.id));
    return view.fieldIds.flatMap((id) => {
      const f = entity.fields.find((x) => x.id === id);
      return f && !shown.has(f.id) ? [f.name] : [];
    });
  }, [view, ws.blueprint, entity]);
  // Blocks shown with the form (payment methods, FAQs), previewed as visitors see them.
  const blocks = useMemo(
    () => (view.blocks?.length ? resolveBlocks(ws.blueprint, ws.records, ws.docs, ws.id, view) : []),
    [ws.blueprint, ws.records, ws.docs, ws.id, view],
  );

  const reset = () => {
    setCreatedId(null);
    setValues(blank());
    setExtras({});
    setStep(0);
    setRound((n) => n + 1);
  };

  const next = () => {
    const missing = missingInStep(entity, steps[step], values);
    if (missing.length) {
      setErrors(missing.map((id) => ({ fieldId: id, message: `${getField(entity, id).name} is required` })));
      return;
    }
    setErrors([]);
    setStep((s) => s + 1);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (wizard && !last) return next();
    const result = actions.create(entity.id, values);
    if (result.ok) {
      // Add-ons become line items under the new record.
      const line = view.extras && ws.blueprint.entities.find((e) => e.id === view.extras?.lineEntityId);
      if (view.extras && line?.parent)
        for (const item of picked) {
          const data: RecordData = {
            [line.parent.fieldId]: result.record.id,
            [view.extras.itemFieldId]: item.id,
          };
          if (view.extras.quantityFieldId) data[view.extras.quantityFieldId] = extras[item.id];
          // Other counts start at 1, and the line's own name (a Title field) is the item's.
          for (const f of line.fields) {
            if (data[f.id] !== undefined) continue;
            if (f.required && f.type === "number") data[f.id] = 1;
            if ((f.required || f.id === line.primaryFieldId) && f.type === "text") data[f.id] = item.title;
          }
          actions.create(line.id, data);
        }
      setCreatedId(result.record.id);
      setErrors([]);
    } else {
      setErrors(result.errors);
      // Send the person back to the step that asks the first field with a problem.
      const at = stepOfField(steps, result.errors.find((e) => e.fieldId)?.fieldId);
      if (at >= 0) setStep(at);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PublicBar view={view} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[560px] px-5 py-8">
          {created ? (
            <div className="flex animate-rise flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center">
              <CheckCircleIcon weight="fill" className="size-8 text-primary" />
              <h2 className="text-[16px] font-semibold">{entity.name} saved</h2>
              <p className="text-[13px] text-muted-foreground">{recordTitle(entity, created)}</p>
              <div className="mt-2 flex gap-2">
                <Button onClick={reset}>Add another</Button>
                <Button variant="outline" onClick={() => openRecord(created.id)}>
                  Open {noun}
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={submit}
              noValidate
              className="flex min-w-0 flex-col gap-5 rounded-lg border p-5 [overflow-wrap:anywhere] md:p-6"
            >
              <div className="flex flex-col gap-1">
                <h2 className="text-[16px] font-semibold">{view.name}</h2>
                <p className="text-[13px] text-muted-foreground">
                  {view.intro ?? `Fill in the details to add a ${noun}. Fields marked * are required.`}
                </p>
                {hiddenFromVisitors.length ? (
                  <p className="mt-1 text-[12px] text-muted-foreground/80">
                    Visitors don't see {hiddenFromVisitors.join(", ")}. Your team fills those in.
                  </p>
                ) : null}
              </div>
              {wizard ? (
                <StepIndicator steps={titles} current={step} onSelect={(i) => i < step && setStep(i)} />
              ) : null}
              {wizard && !reviewing ? (
                <div className={cn("flex flex-col gap-0.5", !steps[step].description && "sm:hidden")}>
                  <h3 className="text-[14px] font-medium sm:hidden">{steps[step].title}</h3>
                  {steps[step].description ? (
                    <p className="text-[12.5px] text-muted-foreground">{steps[step].description}</p>
                  ) : null}
                </div>
              ) : null}
              {reviewing ? (
                <dl className="flex flex-col divide-y rounded-md border text-[13px]">
                  {steps.flatMap((s, si) =>
                    s.fieldIds.map((id) => {
                      const field = getField(entity, id);
                      return (
                        <div key={id} className="flex items-center justify-between gap-4 px-3.5 py-2.5">
                          <dt className="text-muted-foreground">{field.name}</dt>
                          <dd className="flex min-w-0 items-center gap-3 text-right">
                            <FieldValue field={field} value={values[id]} />
                            <button
                              type="button"
                              onClick={() => setStep(si)}
                              className="rounded-sm text-[12px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                              Edit
                            </button>
                          </dd>
                        </div>
                      );
                    }),
                  )}
                  {picked.length && offered ? (
                    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
                      <dt className="text-muted-foreground">{offered.title}</dt>
                      <dd className="text-right">
                        {picked.map((i) => `${i.title} × ${extras[i.id]}`).join(", ")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <>
                  {!wizard || steps[step].fieldIds.length ? (
                    <RecordFieldsForm
                      key={`${round}-${step}`}
                      entity={entity}
                      values={values}
                      errors={errors}
                      idPrefix={`form-${view.id}`}
                      fieldIds={wizard ? steps[step].fieldIds : view.fieldIds}
                      exact={wizard}
                      onChange={(fieldId, value) => {
                        setValues((v) => ({ ...v, [fieldId]: value }));
                        setErrors((list) => list.filter((e) => e.fieldId !== fieldId));
                      }}
                    />
                  ) : null}
                  {offered && (wizard ? steps[step].extras : true) ? (
                    <ExtrasPicker
                      title={offered.title}
                      items={offered.items}
                      value={extras}
                      onChange={(id, n) => setExtras((s) => ({ ...s, [id]: n }))}
                    />
                  ) : null}
                </>
              )}
              {general.length ? (
                <p role="alert" className="text-[13px] text-destructive">
                  {general[0].message}
                </p>
              ) : null}
              {canEdit(ws.role) ? (
                <>
                  {button.note && (!wizard || last) ? (
                    <p className="rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px] text-muted-foreground">
                      {button.note}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2">
                    {wizard && step > 0 ? (
                      <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
                        <ArrowLeftIcon data-icon="inline-start" />
                        Back
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      className={cn(
                        "h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal",
                        wizard ? "ml-auto" : "self-start",
                      )}
                    >
                      {wizard && !last ? (
                        <>
                          Next
                          <ArrowRightIcon data-icon="inline-end" />
                        </>
                      ) : (
                        button.label
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  You have view-only access to this workspace.
                </p>
              )}
            </form>
          )}
          {blocks.length ? (
            <div className="mt-10">
              <PublicBlocks blocks={blocks} slug={ws.id} preview />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
