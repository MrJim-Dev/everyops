import { z } from "zod";
import type { FieldType } from "@/lib/blueprint/types";
import { FUNCTIONS } from "@/lib/engine/expr";

/** Gemini's output schema and instructions for planning workspace changes. */
const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "money",
  "percent",
  "date",
  "datetime",
  "select",
  "multi_select",
  "status",
  "relation",
  "checkbox",
  "formula",
] as const satisfies readonly FieldType[];

const TONES = ["neutral", "accent", "warning", "danger", "success"] as const;
const RESULT_TYPES = ["number", "money", "text", "checkbox", "date"] as const;

const option = z.object({ id: z.string(), label: z.string(), tone: z.enum(TONES) });
const formula = z.object({
  expr: z.string().describe("Expression in the EveryOps formula language"),
  resultType: z.enum(RESULT_TYPES),
  freezeWhen: z.string().optional().describe("Keep stored values when this is true, e.g. for paid records"),
});

/** A flat operation shape is easier for the model to follow than a union; it is checked below. */
const flatOp = z.object({
  op: z.enum(["add_field", "update_field", "add_view_field", "rename_workspace"]),
  entityId: z.string().optional(),
  fieldId: z.string().optional().describe("Existing field id (update_field, add_view_field)"),
  viewId: z.string().optional().describe("Existing table view id (add_view_field)"),
  name: z.string().optional().describe("New workspace name (rename_workspace)"),
  field: z
    .object({
      id: z.string().describe("snake_case, unique within the entity"),
      name: z.string(),
      type: z.enum(FIELD_TYPES),
      description: z.string().optional(),
      required: z.boolean().optional(),
      options: z.array(option).optional(),
      relation: z.object({ entityId: z.string() }).optional(),
      formula: formula.optional(),
    })
    .optional()
    .describe("The new field (add_field)"),
  patch: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      required: z.boolean().optional(),
      options: z.array(option).optional(),
      formula: formula.optional(),
    })
    .optional()
    .describe("What to change on an existing field (update_field). The type cannot change."),
});

// Column order gets its own shape with everything required: as an optional part of the flat shape, Gemini
// left fieldIds out every time.
const setViewFields = z.object({
  op: z.literal("set_view_fields"),
  viewId: z.string().describe("Existing table view id"),
  fieldIds: z.array(z.string()).describe("Every column the table keeps, in the new order"),
});

const op = z.union([flatOp, setViewFields]);

export const answer = z.object({
  status: z.enum(["plan", "clarify", "unsupported"]),
  message: z.string().optional().describe("For clarify/unsupported: one short sentence to the owner"),
  // Operations come first so the model settles the actual changes before writing any text about them.
  ops: z.array(op).describe("The operations. Empty unless status is plan."),
  facts: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe("Up to 4 key values the owner should confirm. Empty unless status is plan."),
  steps: z
    .array(z.object({ kind: z.enum(["add", "change"]), label: z.string(), detail: z.string() }))
    .describe("One line per visible change. Empty unless status is plan."),
  title: z.string().describe("2 to 6 words, sentence case, e.g. 'Peak-hour pricing'"),
});
export type Answer = z.infer<typeof answer>;

export const SYSTEM = `You plan changes to an EveryOps workspace. EveryOps runs small businesses in the Philippines
(bookings, point of sale, staff, finances) from a JSON blueprint: entities with fields, views, widgets and rules.
The owner describes a change in plain words; you return a plan of operations. Nothing is applied until they approve it.

Operations you may use (nothing else):
- add_field: add "field" to entity "entityId". Choose a new snake_case id. Then add it to that entity's table views with add_view_field.
- update_field: change an existing field ("entityId", "fieldId") with "patch": name, description, required, options, or formula. Never change its type.
- add_view_field: show field "fieldId" in table view "viewId".
- set_view_fields: set table view "viewId"'s columns to "fieldIds", in that order. Use it to reorder, show or hide
  columns ("move Amount before Status", "put Court first"). Start from the view's current fieldIds and keep every
  column the owner didn't ask to remove; the step detail shows the new order.
- rename_workspace: set the workspace name to "name".
You can never delete fields, records or views.

Formula language (for formula.expr, formula.freezeWhen):
- Field references by id: rate, start_time. Through a relation field: player.member.
- Numbers, 'strings', true, false, null. Operators: + - * / % == != < <= > >= && || ! and cond ? a : b.
- Functions: ${Object.keys(FUNCTIONS).join(", ")}. hour(x) and weekday(x) read the start of a date, datetime or time range in Asia/Manila (weekday 0 = Sunday). duration_hours(range) and days(range) measure time ranges.
- Money is a plain number in PHP. Formulas recompute existing records, except records matching freezeWhen.

Rules:
- Make the smallest change that does what was asked, using ids that exist in the blueprint.
- When updating a formula, keep its resultType and freezeWhen unless asked otherwise.
- When changing a select or status field's options, keep every existing option id: rename its label if needed, and
  add new options next to it. Records store the id, so dropping an option strands the records that use it.
- facts: the key values the owner should confirm (e.g. "Peak hours: 5 PM – 10 PM", "Rate: ₱520 per hour").
- steps: one line per visible change, kind "add" or "change", detail like "₱400 → ₱520 per hour".
- Every number in facts and steps must match the operations exactly (same amounts, hours and percentages). Never round or restate them differently.
- If the request is ambiguous in a way that changes the result, return status "clarify" with one question.
- If it needs something these operations can't do (new screens, deleting data, integrations), return "unsupported" and say what you can do instead.
- The owner may attach files (a new price list, a photo of a form, a CSV with extra columns). Use them to fill in the
  change (new options, new rates, fields for columns they show); they can't add records here.
- Write for a busy owner: short, plain, no jargon, no field ids in user-facing text.`;
