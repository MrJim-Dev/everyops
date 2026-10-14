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
    .filter((s) => s.fieldIds.length || (s.extras && view.extras) || s.blockIds?.length);
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
  if (!title)
    return steps.filter((s) => s.fieldIds.length || s.blockIds?.length).map(({ extras: _, ...s }) => s);
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

/**
 * The assistant writes a multi-step form as one list of fields with "# Step title" before each step's fields (its
 * answer schema has no room for step objects). Returns the plain fields and, with two or more steps, the steps.
 */
/** A form's fields as the assistant writes them: "# Step title" before each step, "@block_id" for blocks it shows. */
export function markersOf(view: FormView): string[] {
  if (!view.steps?.length) return view.fieldIds;
  return view.steps.flatMap((s) => [
    `# ${s.title}`,
    ...(s.blockIds ?? []).map((id) => `@${id}`),
    ...s.fieldIds,
  ]);
}

export function stepsFromMarkers(ids: string[]): { fieldIds: string[]; steps?: FormStep[] } {
  // "@block_id" shows one of the form's blocks (payment methods, FAQs) in the step it's listed in.
  const fieldIds = ids.filter((id) => !/^[#@]/.test(id.trim()));
  if (fieldIds.length === ids.length) return { fieldIds };
  const steps: FormStep[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (id.startsWith("#")) {
      const title = id.replace(/^#+\s*/, "").slice(0, 60) || `Step ${steps.length + 1}`;
      const slug =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "") || "step";
      steps.push({
        id: steps.some((s) => s.id === slug) ? `${slug}_${steps.length + 1}` : slug,
        title,
        fieldIds: [],
      });
    } else {
      if (!steps.length) steps.push({ id: "details", title: "Details", fieldIds: [] });
      const step = steps[steps.length - 1];
      if (id.startsWith("@")) {
        const block = id.slice(1).trim();
        if (block) step.blockIds = [...(step.blockIds ?? []), block];
      } else step.fieldIds.push(id);
    }
  }
  const kept = steps.filter((s) => s.fieldIds.length || s.blockIds?.length);
  return kept.length > 1 ? { fieldIds, steps: kept } : { fieldIds };
}
