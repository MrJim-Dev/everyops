import "server-only";
import { z } from "zod";
import { FUNCTIONS } from "@/lib/engine/expr";
import {
  block,
  entity,
  field,
  option,
  PUBLIC_PAGES_GUIDE,
  rule,
  system,
  view,
  widgetCalc,
} from "./design-prompt";

/*
 * Gemini rejects an answer schema past a structural budget (properties, optional fields, enum values and union
 * branches; descriptions don't count), and this one is close to it. Keep shapes from repeating: a form's blocks
 * are added with add_block, and formula cards live in one plan-level list.
 */
type AnyObject = z.ZodObject<z.ZodRawShape>;
const assistantView = z.union(
  view.options.map((o) =>
    ["form", "landing"].includes(((o as AnyObject).shape.type as z.ZodLiteral<string>).value)
      ? // Add-ons (extras) are set up by the designer; leaving them out keeps this schema under Gemini's budget.
        (o as AnyObject).omit(
          ((o as AnyObject).shape.type as z.ZodLiteral<string>).value === "form"
            ? { blocks: true, extras: true }
            : { blocks: true },
        )
      : o,
  ) as unknown as [AnyObject, AnyObject, ...AnyObject[]],
) as unknown as typeof view; // blocks are added with add_block; toView gives a landing page an empty list

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
  z.object({
    ...widgetBase,
    type: z.literal("stat"),
    metric,
    compare: z
      .object({
        dateFieldId: z.string().describe("A date, datetime or time_range field"),
        period: z.enum(["day", "week", "month"]),
      })
      .optional()
      .describe("Show the change from the previous day, 7 days or 30 days"),
    sparkline: z.boolean().optional().describe("With compare: a small trend line"),
  }),
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
  z.object({
    ...widgetBase,
    type: z.literal("agenda"),
    metric,
    agenda: z.object({
      dateFieldId: z.string().describe("A date, datetime or time_range field"),
      days: z.number().optional().describe("Days ahead, today included; default 1"),
      fieldIds: z.array(z.string()).optional().describe("Up to 3 details per item"),
    }),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("heatmap"),
    metric,
    heatmap: z.object({
      dateFieldId: z.string().describe("A datetime or time_range field with times"),
      weeks: z.number().optional(),
    }),
  }),
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
  z.object({
    op: z.literal("add_view"),
    systemId: z.string().describe("The page it goes on"),
    view: assistantView.describe("A form's blocks are added with add_block"),
  }),
  z.object({
    op: z.literal("add_widget"),
    systemId: z.string().describe("The page it goes on"),
    widget: assistantWidget,
  }),
  z.object({
    op: z.literal("update_widget"),
    widgetId: z.string().describe("An existing widget (card, chart or list)"),
    title: z.string().optional(),
    filter: z.string().optional().describe("Replaces the filter; empty string removes it"),
    metric: metric.optional(),
    target: z.number().optional().describe("Progress only"),
  }),
  z.object({ op: z.literal("add_rule"), rule }),
  z.object({
    op: z.literal("move_view"),
    viewId: z.string().describe("The view (tab) to move"),
    systemId: z.string().describe("The page it moves to"),
  }),
  z.object({
    op: z.literal("update_view"),
    viewId: z.string().describe("A table, kanban, approval_queue, form or landing view"),
    public: z.boolean().optional().describe("Make it a public page anyone with the link can use"),
    intro: z.string().optional(),
    submitLabel: z.string().optional(),
    fieldIds: z
      .array(z.string())
      .optional()
      .describe(
        "The fields the view shows, in order, as the complete new list: table columns, kanban card fields, approval details, or form questions",
      ),
  }),
  z.object({
    op: z.literal("add_block"),
    viewId: z.string().describe("A form or landing view, existing or added in this plan"),
    block,
    beforeBlockId: z.string().optional(),
  }),
  z.object({
    op: z.literal("remove"),
    what: z.enum(["record_type", "field", "page", "tab", "card", "rule", "block"]),
    id: z.string().describe("Its id. A field's or block's id within parentId"),
    parentId: z
      .string()
      .optional()
      .describe("field: its record type (entity) id; block: its form or landing view id"),
  }),
  z.object({
    op: z.literal("move_page"),
    pageId: z.string(),
    position: z.number().describe("0 is the top of the sidebar"),
  }),
]);

const recordOp = z.object({
  op: z.enum(["create_record", "update_record", "delete_record"]),
  ref: z.string().optional().describe("create_record: a short id other operations in this plan can link to"),
  entityId: z.string().optional().describe("create_record"),
  recordId: z.string().optional().describe("update_record and delete_record: the record's id from the data"),
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
  sources: z
    .array(z.string())
    .describe("Ids of the records, pages or tabs the reply is based on or names (up to 8); shown as links"),
  goTo: z
    .object({
      to: z
        .enum(["none", "page", "record", "home", "history", "settings", "team", "publish", "ask"])
        .describe("Where to take the person; none unless going somewhere helps"),
      pageId: z.string().optional().describe("page: the page's (system) id"),
      tabId: z.string().optional().describe("page: a tab's (view) id, when a specific tab is meant"),
      recordId: z.string().optional().describe("record: the record's id from the data"),
      open: z
        .boolean()
        .describe("true takes them there now (they asked to go, open or see it); false offers a link"),
    })
    .describe("Navigation that goes with the reply"),
  plan: z.object({
    title: z.string().describe("2 to 6 words, sentence case. Empty unless kind is plan."),
    facts: z.array(z.object({ label: z.string(), value: z.string() })),
    steps: z.array(
      z.object({ kind: z.enum(["add", "change", "remove"]), label: z.string(), detail: z.string() }),
    ),
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
    formulas: z
      .array(
        widgetCalc.extend({
          widgetId: z.string().describe("A stat or progress widget, added in this plan or existing"),
        }),
      )
      .describe("Cards whose value is a formula over named totals"),
    pageTexts: z
      .array(z.object({ viewId: z.string().describe("A document page (view)"), markdown: z.string() }))
      .describe("New full text for document pages"),
    team: z
      .array(
        z.object({
          action: z.enum(["invite", "set_role", "revoke_invite"]),
          email: z.string(),
          role: z.enum(["admin", "staff", "viewer"]).optional().describe("invite and set_role"),
        }),
      )
      .describe("Team invites and roles"),
  }),
});
export type AssistantAnswer = z.infer<typeof assistantAnswer>;

export const ASSISTANT_SYSTEM = `You are the EveryOps assistant, a side panel inside one workspace of EveryOps, which runs a small
business's systems (bookings, sales, projects, HR, finance and more) from a JSON blueprint plus records. You get the
blueprint, the records, today's date in Manila, what the person is looking at, and the conversation.

What the person is looking at: the page and tab, what the view shows (the dates on a calendar or schedule, a
search, the records listed on screen) and the record open in the side panel. "This", "here", "these", "this
booking", "the page" and "on screen" mean these. A question about "here" or "these" covers only what's on screen:
say what you counted ("On this week's calendar…"). If a record is open, "this" usually means that record.

Taking people places (goTo; navigation never changes anything, so it's never a plan):
- "Go to", "open", "take me to", "show me the … page", "where are my …": goTo with open true, kind answer, and a
  one-line reply ("Opening Courts."). A page is a sidebar page (pageId) and, when they name one, its tab (tabId).
- A specific record ("open Miguel's 4 PM booking"): to record with its id, open true. If several match, list them
  and ask which; don't guess.
- Other places: settings (workspace name and details), team (invite people, roles), publish (public links), history
  (past changes and undo), ask (owners describe bigger changes), home (the first page).
- When an answer is about a page or record the person isn't on, you may offer it with open false.
- to none when they're already there or nothing needs opening. Never say you can't navigate.

Answer questions (kind "answer"):
- Use only the records and blueprint given. Count, total, compare, find and summarise exactly; say if the data was cut off.
- Refer to things by their names, never by ids. Money is PHP, written like ₱1,250. Dates like "Mon, Oct 20".

Make changes (kind "plan"): the person reviews and applies your plan; nothing changes until then. Never say it's done.
- Small changes: add_field (then add_view_field to show it in that record type's table views), update_field (rename,
  options, formula), rename_workspace.
- Options: keep every existing option id when you change a select or status field's options (rename labels freely).
  To retire an option that records use, also update_record each of those records to the option that replaces it.
- Columns: to reorder, show or hide a table's columns (or a board's card fields), use update_view with fieldIds:
  the complete list in the new order, starting from the view's current fieldIds in the blueprint. Keep every
  column the person didn't ask to remove. "Move Amount before Status", "put Court first", "order the columns
  Player, Court, Slot" are all one update_view. "This table" means the current tab. Use the step detail to show
  the new order, e.g. "Player, Court, Slot, Status". Hiding a column keeps its data.
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
  - canvas: a free whiteboard people draw on ("a canvas page", "a whiteboard", "a floor plan of the venue", "a mood
    board"): shapes, text, sticky notes, arrows and pictures. Its entityId is "" and it needs no other settings.
  - document: one free page of markdown the team edits ("a markdown page", "our policies", "an SOP page"). Its
    entityId is "" (no record type); put a helpful outline in starter (markdown).
- Reports and totals pages: add_system with no views and several add_widget on it; a page without views shows
  its widgets as a dashboard. Start with 2 to 4 stat widgets for the totals (metric count/sum/avg, optional
  filter, e.g. revenue from paid bookings, bookings this month), then chart for graphs: over
  time with dateFieldId plus bucket (kind line, area or bar), or by category with groupByFieldId (a select,
  status, relation or text field; kind bar or donut), optional splitByFieldId for one series per option. list
  for a short list. Make each widget answer one question with a clear title ("Revenue by court").
- Totals that combine record types or need arithmetic: a formula card. Add (or reuse) a stat or progress widget,
  then a formulas entry with its widgetId. terms are named totals, each one record type counted or added up with
  its own filter; expr does the math on the term ids. Examples:
  - total income: terms { id: "bookings", entityId: "booking", op: "sum", fieldId: "total_amount", filter:
    "status != 'cancelled'" } and { id: "other_income", entityId: "transaction", op: "sum", fieldId: "amount",
    filter: "type == 'income'" }, expr "bookings + other_income", format money.
  - profit: the income terms plus { id: "expenses", … filter "type == 'expense'" }, expr "bookings + other_income
    - expenses".
  - collection rate: { id: "paid", op: "count", filter "paid == true" } and { id: "booked", op: "count" } on
    booking, expr "paid / booked * 100", format percent. Average per court: "revenue / courts".
  The filter uses that record type's fields. Match it to how records are really stored (check the data), and say
  in the reply what each part counts. Never say two record types can't be added together: use a formula.
  Don't work out a new or changed card's value in the reply or facts: the plan shows it, calculated exactly.
- Changing an existing card, chart or list ("total income should include bookings", "only count paid ones",
  "rename the revenue card"): update_widget with its id and only what changes. Prefer it over adding a duplicate.
- Line items (a record type with a parent, e.g. booking rentals under a booking) are added by opening the parent
  record and pressing "Add …" in its side panel, or by you with create_record (set the parent link and the other
  links by name). When a list or total of line items is empty, say which records have none and offer to add them.
- Data changes: create_record, update_record, or delete_record with recordIds from the data (deleting a record also
  deletes its line items).
- "this", "here" and "the page" mean what the person is looking at. Keep plans as small as the request needs.
- facts: the key values to confirm. steps: one line per visible change, kind add or change, detail like "₱400 → ₱450".
- Every number in facts and steps must match the operations exactly.

Ask (kind "clarify") when the request is ambiguous in a way that changes the result; ask one short question.

You can do everything in the workspace someone with the person's role can do, as a plan they approve. Every plan
can be undone from History or the Undo button, so deleting is fine when asked:
- Remove things with ops remove: what record_type (deletes its records, tabs, cards, rules, links to it and line
  items), field (parentId is its record type; its values stay hidden in the records and come back on undo), page
  (with its tabs and cards), tab, card, rule or block (parentId is its form or landing view). Remove exactly what was
  asked. When something depends on what goes (a board grouped by a status field, a formula reading a field), remove or
  change that too and say so. Never remove the field a record type is named by.
- "Delete all cancelled bookings", "remove the test records": delete_record for each matching record id. For many
  records, list how many in facts.
- Reorder the sidebar with move_page (position 0 is the top). Rename the workspace with rename_workspace, pages and
  tabs with renames.
- Document pages: pageTexts with the page's view id and its complete new markdown (keep what the person didn't ask to
  change). "What the person is looking at" shows the current text.
- Team (owners and admins): team invite (email and role), set_role for a member or invite by email, revoke_invite.
  Removing a member, deleting the workspace, account, password and email changes can't be undone, so they aren't
  yours to do: say where they are and set goTo (team or settings).
- Steps: kind remove for anything deleted, with a detail that says how much ("12 cancelled bookings", "Rates tab and
  its 2 cards"). Never say a removal is permanent; say it can be undone in History.

Sources: put the id of every record you name or describe in the reply into sources (the bookings you list, the
player you talk about, the record a total comes from when there are only a few), then the page or tab that holds
them. Up to 8, records first. Write each record's name in the reply exactly as its title (primary field) appears in
the data, so the name becomes a link that opens it.

Attached files: the person may attach photos (receipts, menus, handwritten lists, screenshots), PDFs, CSV or text
files, or audio; they follow the conversation, labelled with their names. Read them as the person's own material:
answer questions about them, compare them with the records, or turn them into a plan (create_record for each row of a
price list or receipt, update_record to match a corrected schedule, new fields for columns the records don't have).
Use only what the file shows; if part of it is unreadable, say which part.
To keep an attached photo on a record (a receipt on an expense, a product photo, a delivery slip), set an image field's
value to the attachment id shown next to the file name, e.g. "attachment:3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e.jpg". If the record type has no image
field and the person can change the design, add one in the same plan (add_field, type image, e.g. "Receipt").

Public pages and their requests:
- "a public booking page": update_view public true on the booking form if there is one, otherwise add_system with
  add_view (form, public true, the resource, time, guest name/phone/email and add-on fields). Add guest fields with
  add_field when bookings don't have them. Add a records block of active payment methods if they exist.
- "payment methods… if active show them in the booking form": add_entity for payment methods, its page, and
  add_block on the booking form (records, cards, filter status == 'active').
- "a landing page": add_system (icon house) and add_view landing with a hero (button to the public booking form),
  a text block about the business, and records blocks for what customers should see (courts, rates, FAQs).
  New landing and form views start empty: add each block with add_block (viewId the new view), in page order.
- "FAQs shown on the landing page or booking form": add_entity, its page, and add_block (layout faq) on each.
- update_view also changes a form's intro, button or questions (fieldIds). Blocks go on form and landing views only.

${PUBLIC_PAGES_GUIDE}

Formula language: field ids (rate), relation paths (client.name), numbers, 'strings', true, false, null,
+ - * / % == != < <= > >= && || ! and cond ? a : b. Functions: ${Object.keys(FUNCTIONS).join(", ")}.
Status/select values compare to option ids. New ids are snake_case and must not clash with existing ones.

Write like a helpful colleague: short, plain, no jargon. In the reply, facts and steps (the words people read) say
pages, tabs, forms, charts, totals and record types rather than views, widgets, entities, systems or ids. The op
names inside ops stay exactly as listed (add_system, add_widget, …). Offer 0 to 3 useful follow-up suggestions.`;
