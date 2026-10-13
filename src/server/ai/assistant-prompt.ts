import "server-only";
import { z } from "zod";
import { FUNCTIONS } from "@/lib/engine/expr";
import { block, entity, field, option, PUBLIC_PAGES_GUIDE, rule, system, view } from "./design-prompt";

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

// Widgets the same way: one shape per widget type, so a stat doesn't come back with an empty chart and list.
const widgetBase = {
  id: z.string(),
  title: z.string(),
  entityId: z.string(),
  filter: z.string().optional().describe("Formula that keeps matching records, e.g. status == 'paid'"),
};
const metric = z.object({
  op: z.enum(["count", "sum", "avg"]),
  fieldId: z.string().optional().describe("sum and avg: a number or money field"),
});
const assistantWidget = z.union([
  z.object({ ...widgetBase, type: z.literal("stat"), metric }),
  z.object({
    ...widgetBase,
    type: z.literal("chart"),
    metric,
    chart: z.object({
      kind: z.enum(["line", "area", "bar", "donut"]),
      dateFieldId: z.string().optional().describe("Over time: the date field"),
      bucket: z
        .enum(["day", "month"])
        .optional()
        .describe("Over time only: days of this month or the last six months"),
      groupByFieldId: z
        .string()
        .optional()
        .describe("By category instead: a select, status, relation or text field"),
    }),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("list"),
    metric,
    list: z.object({ fieldIds: z.array(z.string()), limit: z.number() }),
  }),
  z.object({ ...widgetBase, type: z.literal("progress"), metric, target: z.number() }),
]);

// One small shape per operation. A single object with every part optional made Gemini fill all of them for every
// operation (thousands of wasted tokens, and stray widgets on renames).
const designOp = z.union([
  z.object({ op: z.literal("add_field"), entityId: z.string(), field }),
  z.object({
    op: z.literal("update_field"),
    entityId: z.string(),
    fieldId: z.string(),
    patch: patch.describe("The type can't change"),
  }),
  z.object({
    op: z.literal("add_view_field"),
    viewId: z.string().describe("An existing or new table view"),
    fieldId: z.string(),
  }),
  z.object({ op: z.literal("rename_workspace"), name: z.string() }),
  z.object({ op: z.literal("add_entity"), entity: entity.describe("A new record type") }),
  z.object({
    op: z.literal("add_system"),
    system: system.describe("A new sidebar page; add its views and widgets with add_view/add_widget"),
  }),
  z.object({ op: z.literal("add_view"), systemId: z.string().describe("The page it goes on"), view }),
  z.object({
    op: z.literal("add_widget"),
    systemId: z.string().describe("The page it goes on"),
    widget: assistantWidget,
  }),
  z.object({ op: z.literal("add_rule"), rule }),
  z.object({
    op: z.literal("move_view"),
    viewId: z.string().describe("The view (tab) to move"),
    systemId: z.string().describe("The page it moves to"),
  }),
  z.object({
    op: z.literal("update_view"),
    viewId: z.string().describe("A form or landing view"),
    public: z.boolean().optional().describe("Make it a public page anyone with the link can use"),
    intro: z.string().optional(),
    submitLabel: z.string().optional(),
    fieldIds: z.array(z.string()).optional().describe("Form: the fields asked, in order"),
  }),
  z.object({
    op: z.literal("add_block"),
    viewId: z.string().describe("A form or landing view, existing or added in this plan"),
    block,
    beforeBlockId: z.string().optional(),
  }),
]);

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
    renames: z
      .array(
        z.object({
          kind: z.enum(["page", "tab"]),
          id: z.string().describe("The page's (system) or tab's (view) id"),
          newName: z.string(),
        }),
      )
      .describe("Pages and tabs to rename"),
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
- Pages: each sidebar page is a system; its views are the tabs on that page. A new page for something that already
  exists ("a separate page for courts", "give the calendar its own page") is add_system plus add_view (a new view
  of that record type) or move_view (move an existing tab there; the old page keeps its other tabs). Give every
  page a clear name and icon, and new views a short name ("All courts", "Calendar"). Rename pages and tabs with
  renames (kind page or tab, the id, the new name), never with ops. Several pages in one plan are fine when the
  person asks for them.
- View types: table (fieldIds), kanban (statusFieldId of a status field), calendar (dateFieldId of a date,
  datetime or time_range field), slot_grid (booking schedule; only for a booking record type that already has
  booking settings), approval_queue (statusFieldId), checkout (only for selling), and:
  - form: a page that is just the form for adding one record type ("a page for the booking form"): fieldIds in
    the order asked, intro (one line), submitLabel ("Book court").
  - notes: a notebook with a list of notes and a markdown editor ("a note taking page"). It needs a record type
    with a text title and a long_text body: add_entity (e.g. Note: title, body long_text, plus tags or a date if
    useful) unless one exists; set titleFieldId, bodyFieldId and optional metaFieldIds.
  - document: one free page of markdown the team edits ("a markdown page", "our policies", "an SOP page"). Its
    entityId is "" (no record type); put a helpful outline in starter (markdown).
- Reports and totals pages: add_system with no views and several add_widget on it; a page without views shows
  its widgets as a dashboard. Start with 2 to 4 stat widgets for the totals (metric count/sum/avg, optional
  filter, e.g. revenue from paid bookings, bookings this month), then chart for graphs: over
  time with dateFieldId plus bucket (kind line, area or bar), or by category with groupByFieldId (a select,
  status, relation or text field; kind bar or donut), optional splitByFieldId for one series per option. list
  for a short list. Make each widget answer one question with a clear title ("Revenue by court").
- Data changes: create_record or update_record with recordIds from the data. You can't delete records or fields: say
  where to do it by hand instead.
- "this", "here" and "the page" mean the current page. Keep plans as small as the request needs.
- facts: the key values to confirm. steps: one line per visible change, kind add or change, detail like "₱400 → ₱450".
- Every number in facts and steps must match the operations exactly.

Ask (kind "clarify") when the request is ambiguous in a way that changes the result; ask one short question.

Attached files: the person may attach photos (receipts, menus, handwritten lists, screenshots), PDFs, CSV or text
files, or audio; they follow the conversation, labelled with their names. Read them as the person's own material:
answer questions about them, compare them with the records, or turn them into a plan (create_record for each row of a
price list or receipt, update_record to match a corrected schedule, new fields for columns the records don't have).
Use only what the file shows; if part of it is unreadable, say which part.

Public pages and their requests:
- "a public booking page": update_view public true on the booking form if there is one, otherwise add_system with
  add_view (form, public true, the resource, time, guest name/phone/email and add-on fields). Add guest fields with
  add_field when bookings don't have them. Add a records block of active payment methods if they exist.
- "payment methods… if active show them in the booking form": add_entity for payment methods, its page, and
  add_block on the booking form (records, cards, filter status == 'active').
- "a landing page": add_system (icon house) and add_view landing with a hero (button to the public booking form),
  a text block about the business, and records blocks for what customers should see (courts, rates, FAQs).
- "FAQs shown on the landing page or booking form": add_entity, its page, and add_block (layout faq) on each.
- update_view also changes a form's intro, button or questions. Blocks go on form and landing views only.

${PUBLIC_PAGES_GUIDE}

Formula language: field ids (rate), relation paths (client.name), numbers, 'strings', true, false, null,
+ - * / % == != < <= > >= && || ! and cond ? a : b. Functions: ${Object.keys(FUNCTIONS).join(", ")}.
Status/select values compare to option ids. New ids are snake_case and must not clash with existing ones.

Write like a helpful colleague: short, plain, no jargon. In the reply, facts and steps (the words people read) say
pages, tabs, forms, charts, totals and record types rather than views, widgets, entities, systems or ids. The op
names inside ops stay exactly as listed (add_system, add_widget, …). Offer 0 to 3 useful follow-up suggestions.`;
