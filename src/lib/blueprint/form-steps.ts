import { editableFields } from "./field-kind";
import type { Entity, FieldValue, FormStep, FormView, RecordData } from "./types";

/**
 * A form's steps, each holding only fields that can be asked. Fields the form asks (and required fields) that no
 * step lists go on the last step, so nothing required is ever skipped. Without steps: one step with every field.
 */
export function formSteps(
  entity: Entity,
  view: FormView,
  askable = editableFields(entity).map((f) => f.id),
): FormStep[] {
  const can = new Set(askable);
  const required = editableFields(entity)
    .filter((f) => f.required)
    .map((f) => f.id);
  const asked = [...(view.fieldIds.length ? view.fieldIds : askable), ...required].filter((id) =>
    can.has(id),
  );
  const steps = (view.steps ?? [])
    .map((s) => ({ ...s, fieldIds: s.fieldIds.filter((id) => can.has(id)) }))
    .filter((s) => s.fieldIds.length || (s.extras && view.extras));
  if (!steps.length) return [{ id: "all", title: view.name, fieldIds: [...new Set(asked)] }];
  const placed = new Set(steps.flatMap((s) => s.fieldIds));
  const left = [...new Set(asked)].filter((id) => !placed.has(id));
  if (left.length)
    steps[steps.length - 1] = {
      ...steps[steps.length - 1],
      fieldIds: [...steps[steps.length - 1].fieldIds, ...left],
    };
  return steps;
}

/**
 * Where a form's add-ons go: on the step marked for them, else on a step of their own before the last one (the only
 * step when there's one). With nothing to offer (no extras, or no active items), a step that held only them goes.
 */
export function placeExtras(steps: FormStep[], title: string | undefined): FormStep[] {
  if (!title) return steps.filter((s) => s.fieldIds.length).map(({ extras: _, ...s }) => s);
  if (steps.some((s) => s.extras)) return steps;
  if (steps.length === 1) return [{ ...steps[0], extras: true }];
  const out = [...steps];
  out.splice(Math.max(0, out.length - 1), 0, { id: "extras", title, fieldIds: [], extras: true });
  return out;
}

const isEmpty = (v: FieldValue | undefined) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The required fields of one step that are still empty. */
export function missingInStep(entity: Entity, step: FormStep, values: RecordData): string[] {
  return step.fieldIds.filter(
    (id) => entity.fields.find((f) => f.id === id)?.required && isEmpty(values[id]),
  );
}

/** Which step asks a field, so an error can send the person back to it. */
export function stepOfField(steps: FormStep[], fieldId: string | undefined): number {
  if (!fieldId) return -1;
  return steps.findIndex((s) => s.fieldIds.includes(fieldId));
}
