import "server-only";
import { z } from "zod";
import { FUNCTIONS } from "@/lib/engine/expr";
import { entity, field, option, rule, system, view, widget } from "./design-prompt";

const patch = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(option).optional(),
  formula: z
    .object({
      expr: z.string(),
      resultType: z.enum(["number", "money", "text", "checkbox", "date"]),
      freezeWhen: z.string().optional(),
    })
    .optional(),
});

const designOp = z.object({
  op: z.enum([
    "add_field",
    "update_field",
    "add_view_field",
    "rename_workspace",
    "add_entity",
    "add_view",
    "add_widget",
    "add_system",
    "add_rule",
  ]),
  entityId: z.string().optional().describe("add_field, update_field: the record type"),
  fieldId: z.string().optional().describe("update_field, add_view_field"),
  viewId: z.string().optional().describe("add_view_field: an existing or new table view"),
  systemId: z.string().optional().describe("add_view, add_widget: the sidebar section it goes in"),
  name: z.string().optional().describe("rename_workspace"),
  field: field.optional().describe("add_field"),
  patch: patch.optional().describe("update_field; the type can't change"),
  entity: entity.optional().describe("add_entity: a new record type"),
  view: view.optional().describe("add_view"),
  widget: widget.optional().describe("add_widget"),
  system: system
    .optional()
    .describe("add_system: a new sidebar section; add its views and widgets with add_view/add_widget"),
  rule: rule.optional().describe("add_rule"),
});

const recordOp = z.object({
  op: z.enum(["create_record", "update_record"]),
  ref: z.string().optional().describe("create_record: a short id other operations in this plan can link to"),
  entityId: z.string().optional().describe("create_record"),
  recordId: z.string().optional().describe("update_record: the record's id from the data"),
  values: z.array(
    z.object({
      fieldId: z.string(),
      value: z
        .string()
        .describe(
          "number/money as digits; checkbox true/false; select/status option id; multi_select ids joined by commas; relation the record id, a ref, or the linked record's name; date YYYY-MM-DD; datetime YYYY-MM-DDTHH:MM (Manila); time_range start/end",
        ),
    }),
  ),
});

export const assistantAnswer = z.object({
  kind: z.enum(["answer", "plan", "clarify"]),
  reply: z
    .string()
    .describe(
      "What you say to the person. Plain text; short paragraphs or '- ' bullets; no headings or tables.",
    ),
  suggestions: z.array(z.string()).describe("0 to 3 short follow-ups the person might send next"),
  plan: z.object({
    title: z.string().describe("2 to 6 words, sentence case. Empty unless kind is plan."),
    facts: z.array(z.object({ label: z.string(), value: z.string() })),
    steps: z.array(z.object({ kind: z.enum(["add", "change"]), label: z.string(), detail: z.string() })),
    ops: z.array(designOp).describe("Design changes, applied first"),
    recordOps: z.array(recordOp).describe("Data changes, applied after the design changes"),
  }),
});
export type AssistantAnswer = z.infer<typeof assistantAnswer>;

export const ASSISTANT_SYSTEM = `You are the EveryOps assistant, a side panel inside one workspace of EveryOps, which runs a small
business's systems (bookings, sales, projects, HR, finance and more) from a JSON blueprint plus records. You get the
blueprint, the records, today's date in Manila, the page the person is on, and the conversation.

Answer questions (kind "answer"):
- Use only the records and blueprint given. Count, total, compare, find and summarise exactly; say if the data was cut off.
- Refer to things by their names, never by ids. Money is PHP, written like ₱1,250. Dates like "Mon, Oct 20".

Make changes (kind "plan"): the person reviews and applies your plan; nothing changes until then. Never say it's done.
- Small changes: add_field (then add_view_field to show it in that record type's table views), update_field (rename,
  options, formula), rename_workspace.
- New areas ("I also want to manage my clients"): add_entity with its fields; link it to existing record types with a
  relation field (add_field on the existing type, or a relation field in the new entity); add_system for a sidebar
  section, then add_view (a table, plus a kanban board if it has a status) and optionally add_widget in the existing
  overview section. Use add_rule for automations.
- Data changes: create_record or update_record with recordIds from the data. You can't delete records or fields: say
  where to do it by hand instead.
- "this", "here" and "the page" mean the current page. Keep plans as small as the request needs.
- facts: the key values to confirm. steps: one line per visible change, kind add or change, detail like "₱400 → ₱450".
- Every number in facts and steps must match the operations exactly.

Ask (kind "clarify") when the request is ambiguous in a way that changes the result; ask one short question.

Formula language: field ids (rate), relation paths (client.name), numbers, 'strings', true, false, null,
+ - * / % == != < <= > >= && || ! and cond ? a : b. Functions: ${Object.keys(FUNCTIONS).join(", ")}.
Status/select values compare to option ids. New ids are snake_case and must not clash with existing ones.

Write like a helpful colleague: short, plain, no jargon. Offer 0 to 3 useful follow-up suggestions.`;
