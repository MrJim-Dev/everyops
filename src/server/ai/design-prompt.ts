import "server-only";
import { z } from "zod";
import { FUNCTIONS } from "@/lib/engine/expr";

const TONES = ["neutral", "accent", "warning", "danger", "success"] as const;
const ICONS = [
  "calendar",
  "court",
  "users",
  "user",
  "receipt",
  "storefront",
  "package",
  "chart",
  "wallet",
  "megaphone",
  "image",
  "briefcase",
  "airplane",
  "house",
  "key",
  "gauge",
] as const;
const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "money",
  "percent",
  "date",
  "datetime",
  "time_range",
  "select",
  "multi_select",
  "status",
  "person",
  "relation",
  "checkbox",
  "image",
  "formula",
  "rollup",
] as const;

export const option = z.object({ id: z.string(), label: z.string(), tone: z.enum(TONES) });
const sort = z.object({ fieldId: z.string(), dir: z.enum(["asc", "desc"]) });

export const field = z.object({
  id: z.string().describe("snake_case, unique within the record type"),
  name: z.string(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  description: z.string().optional(),
  options: z.array(option).optional().describe("Required for select, multi_select and status"),
  range: z
    .enum(["dates", "times"])
    .optional()
    .describe("time_range only: whole days (stays, leave) or clock times (bookings)"),
  relation: z.object({ entityId: z.string() }).optional().describe("relation only: the linked record type"),
  formula: z
    .object({
      expr: z.string(),
      resultType: z.enum(["number", "money", "text", "checkbox", "date"]),
      freezeWhen: z.string().optional(),
    })
    .optional()
    .describe("formula only"),
  rollup: z
    .object({
      childEntityId: z.string(),
      viaFieldId: z.string().describe("the relation field on the child that points back here"),
      op: z.enum(["sum", "count", "min", "max", "avg"]),
      fieldId: z.string().optional(),
    })
    .optional()
    .describe("rollup only"),
});

export const entity = z.object({
  id: z.string().describe("snake_case singular, e.g. task"),
  name: z.string(),
  pluralName: z.string(),
  primaryFieldId: z.string().describe("the field that names a record, usually 'name' or 'title'"),
  fields: z.array(field),
  parent: z
    .object({ entityId: z.string(), fieldId: z.string() })
    .optional()
    .describe("Line items: the parent record type and the relation field to it"),
  booking: z
    .object({
      resourceFieldId: z.string(),
      timeFieldId: z.string(),
      statusFieldId: z.string(),
      blockingStatuses: z.array(z.string()),
    })
    .optional()
    .describe(
      "Bookings only: relation to the bookable resource, its time_range field, status, and statuses that block a slot",
    ),
  resource: z
    .object({ opensAt: z.string(), closesAt: z.string(), slotMinutes: z.number() })
    .optional()
    .describe("Bookable resources only (courts, rooms): opening hours HH:MM and slot length 15/30/60/90/120"),
});

const viewBase = { id: z.string(), entityId: z.string(), name: z.string() };
const filter = z.string().optional().describe("Formula that keeps matching records");

/** Pieces of a public page (landing pages, and blocks shown with a public form). */
export const block = z.union([
  z.object({
    type: z.literal("hero"),
    id: z.string(),
    heading: z.string(),
    subheading: z.string().optional(),
    ctaLabel: z.string().optional().describe("Button text, e.g. Book a court"),
    ctaViewId: z.string().optional().describe("The public form the button opens"),
  }),
  z.object({ type: z.literal("text"), id: z.string(), markdown: z.string() }),
  z.object({
    type: z.literal("records"),
    id: z.string(),
    title: z.string().optional(),
    entityId: z.string(),
    filter: z.string().optional().describe("e.g. status == 'active' or published"),
    fieldIds: z.array(z.string()).describe("The first is the title; only these fields are public"),
    layout: z.enum(["cards", "list", "table", "faq"]),
    sort: z.array(sort).optional(),
    limit: z.number().optional(),
  }),
  z.object({
    type: z.literal("form"),
    id: z.string(),
    viewId: z.string().describe("A public form view"),
    title: z.string().optional(),
  }),
  z.object({
    type: z.literal("html"),
    id: z.string(),
    html: z.string().describe("Only when the person asks for HTML"),
  }),
]);

// One shape per view type, so Gemini only writes the settings that view uses.
export const view = z.union([
  z.object({
    ...viewBase,
    type: z.literal("table"),
    fieldIds: z.array(z.string()).describe("Columns"),
    filter,
    sort: z.array(sort).optional(),
  }),
  z.object({
    ...viewBase,
    type: z.literal("kanban"),
    statusFieldId: z.string().describe("A status field"),
    cardFieldIds: z.array(z.string()).optional(),
    filter,
  }),
  z.object({
    ...viewBase,
    type: z.literal("calendar"),
    dateFieldId: z.string().describe("A date, datetime or time_range field"),
    titleFieldId: z.string().optional(),
    filter,
  }),
  z.object({ ...viewBase, type: z.literal("slot_grid") }),
  z.object({
    ...viewBase,
    type: z.literal("checkout"),
    productEntityId: z.string().describe("Products; the view's entity is the order"),
    lineEntityId: z.string().describe("Order line items"),
    paymentFieldId: z.string().describe("Payment method field on the order"),
  }),
  z.object({
    ...viewBase,
    type: z.literal("approval_queue"),
    statusFieldId: z.string(),
    pending: z.string().describe("Option id waiting for a decision"),
    approve: z.string(),
    reject: z.string(),
    approveLabel: z.string().optional(),
    rejectLabel: z.string().optional(),
    detailFieldIds: z.array(z.string()).optional(),
  }),
  z.object({
    ...viewBase,
    type: z.literal("form"),
    fieldIds: z.array(z.string()).describe("The fields asked, in order"),
    intro: z.string().optional(),
    submitLabel: z.string().optional().describe("e.g. Book court"),
    public: z.boolean().optional().describe("Anyone with the link can submit it (a public booking page)"),
    blocks: z.array(block).optional().describe("Shown with the form, e.g. active payment methods, FAQs"),
  }),
  z.object({
    ...viewBase,
    type: z.literal("notes"),
    titleFieldId: z.string().optional(),
    bodyFieldId: z.string().optional().describe("A long_text field holding the note's markdown"),
    metaFieldIds: z.array(z.string()).optional(),
  }),
  z.object({
    ...viewBase,
    type: z.literal("document"),
    starter: z.string().optional().describe("Starting markdown"),
  }),
  z.object({
    ...viewBase,
    type: z.literal("landing"),
    public: z.boolean().optional(),
    blocks: z.array(block).describe("The public page, top to bottom"),
  }),
]);

export const widget = z.object({
  id: z.string(),
  title: z.string(),
  entityId: z.string(),
  filter: z.string().optional(),
  type: z.enum(["stat", "chart", "progress", "list"]),
  metric: z.object({ op: z.enum(["count", "sum", "avg"]), fieldId: z.string().optional() }),
  chart: z
    .object({
      kind: z.enum(["line", "bar", "area", "donut"]),
      dateFieldId: z.string().optional().describe("over time: the date field to bucket by"),
      bucket: z.enum(["day", "week", "month"]).optional().describe("over time only"),
      groupByFieldId: z
        .string()
        .optional()
        .describe("by category: a select, status, relation or text field; required for donut"),
      splitByFieldId: z.string().optional().describe("one series per option of this select or status field"),
    })
    .optional(),
  target: z.number().optional().describe("progress only"),
  list: z
    .object({
      fieldIds: z.array(z.string()),
      limit: z.number(),
      viewId: z.string().optional(),
      sort: z.array(sort).optional(),
    })
    .optional(),
  span: z.enum(["main", "side"]).optional(),
});

const target = z.object({ kind: z.enum(["self", "relation"]), fieldId: z.string().optional() });
export const rule = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.object({
    entityId: z.string(),
    event: z.enum(["created", "updated", "status_changed"]),
    fieldId: z.string().optional(),
    to: z.string().optional().describe("status_changed: the option id it changed to"),
  }),
  when: z.string().optional(),
  actions: z.array(
    z.object({
      type: z.enum(["set_field", "adjust_number", "notify"]),
      target: target.optional(),
      fieldId: z.string().optional(),
      value: z.string().optional().describe("set_field: formula for the new value"),
      delta: z.string().optional().describe("adjust_number: formula, e.g. -qty"),
      message: z.string().optional().describe("notify"),
    }),
  ),
});

export const system = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.enum(ICONS),
  viewIds: z.array(z.string()),
  widgetIds: z.array(z.string()),
});

export const design = z.object({
  workspaceName: z.string(),
  summary: z.string().describe("3 to 6 words for the workspace list, e.g. 'Projects and tasks'"),
  systems: z
    .array(system)
    .describe("Sidebar sections. Start with an Overview system holding the dashboard widgets."),
  entities: z.array(entity),
  views: z.array(view),
  widgets: z.array(widget),
  rules: z.array(rule),
  samples: z
    .array(
      z.object({
        ref: z.string().describe("short unique id for this sample record, used by relation values"),
        entityId: z.string(),
        values: z.array(
          z.object({
            fieldId: z.string(),
            value: z
              .string()
              .describe(
                "number/money as digits; checkbox true/false; select/status the option id; multi_select ids joined by commas; relation the ref of the linked sample; date YYYY-MM-DD; datetime YYYY-MM-DDTHH:MM; time_range start/end with the same formats",
              ),
          }),
        ),
      }),
    )
    .describe(
      "3 to 5 realistic sample records for each main record type (up to 24 in total). Never give values for formula or rollup fields.",
    ),
});
export type Design = z.infer<typeof design>;

/** How public pages, payments and FAQs are built. Shared by the designer and the workspace assistant. */
export const PUBLIC_PAGES_GUIDE = `Public pages (customers use them without an account, at /s/<workspace>/<view>):
- A public form is a form view with public true, e.g. a public booking page. Visitors see only its fields; statuses
  are set by the business (new submissions start at the first status option), so don't ask for them. Booking
  forms ask for the resource (court) and its time_range field; visitors pick a free slot, double bookings are
  refused. Bookings made publicly carry the guest's details as text fields on the booking (guest name, phone,
  email); a relation to people (players, clients) must not be required.
- A landing page is a landing view (entityId "") made of blocks, top to bottom: hero (heading, subheading,
  ctaLabel, ctaViewId = a public form), text (markdown: about, location, hours), records (live data from a record
  type: fieldIds with the title first, a filter, layout cards, list, table or faq), form (embeds a public form),
  html (custom HTML in a sandbox; only when the person asks for HTML). Only fields listed in a block are public,
  so never list private ones (phones of customers, internal notes).
- Payment methods: a record type with name or label (text, primary), type (select: GCash, Maya, Bank transfer,
  Cash, Card…), provider (text), account name (text), account number (text, phone or account no.), instructions
  (long_text), QR code (image) and status (status: active, inactive). Show the active ones on the booking form
  with a records block: layout cards, filter status == 'active', fields label, type, account name, account number,
  instructions, QR code. People upload the QR picture themselves.
- FAQs: a record type with question (text, primary), answer (long_text), order (number) and published (checkbox).
  Show them with a records block: layout faq, fields question then answer, filter published, sorted by order.
- Image fields hold a picture people upload (QR codes, logos). Sample records leave them empty.`;

export const DESIGN_SYSTEM = `You design EveryOps workspaces. A workspace is a JSON blueprint that one generic engine renders,
so you only describe data, screens, dashboards and rules; you never write code. You get a brief from the setup interview
and return the complete blueprint plus sample records.

Formula language (formula.expr, freezeWhen, filters, rule conditions and values):
- Field references by id on the same record (rate, qty); through a relation field: player.member, product.price.
- Numbers, 'strings', true, false, null. Operators: + - * / % == != < <= > >= && || ! and cond ? a : b.
- Functions: ${Object.keys(FUNCTIONS).join(", ")}. hour/weekday read Asia/Manila time (weekday 0 = Sunday);
  duration_hours(range) and days(range) measure time ranges; is_today, is_this_month, is_upcoming test dates.
- Status and select values compare against option ids: status == 'done'.

Rules for a valid blueprint:
- Every id referenced (fields, entities, views, widgets, options) must exist. Ids are snake_case.
- Each record type has a primary field (a text field) and only the fields it needs.
- select, multi_select and status fields need options. Use status for workflows (kanban boards, approvals).
- relation fields set relation.entityId. rollup fields sum/count child records through the child's relation field.
- Kanban boards use a status field. Calendars use a date, datetime or time_range field.
- Bookings of courts, rooms, tables or similar: always a resource record type (courts) with resource hours, and a
  booking record type with booking settings: resourceFieldId (a required relation to the resource), timeFieldId (a
  required time_range field with range "times") and statusFieldId (a status), plus blockingStatuses (every status
  except cancelled). Never model a booking's time as a date plus a start-time select or a duration number: the
  time_range holds both, and duration_hours(time) gives the hours. Give the bookings page a schedule (slot_grid)
  and a list. The schedule, double-booking protection and public booking slots all need this.
- Line items (add-ons on a booking, items on an order, lines on an invoice) set parent to their parent record type
  and the relation field to it; they stay inside the parent's page and don't get their own.
- Everything the owner says they manage gets its own record type and page: "bookings, rentals, rates and add-ons"
  means Bookings, Rentals, Rates and Add-ons. Rates are records (name, price per hour, when they apply) that a
  booking links to. Page names are nouns, never Settings, History or Search (the app has those).
- "A calendar page" means a page with a calendar view (people switch it between month, week and day); a booking
  schedule (slot_grid) is the day-by-court grid. Booking businesses usually want both.
- checkout needs product, order and line-item types (line items have parent set to the order). Only for selling.
- form views are a page that is just the form to add one record type (fieldIds, intro, submitLabel). notes views
  are a notebook over a record type with a text title and a long_text body (titleFieldId, bodyFieldId).
  document views are one free markdown page with entityId "" and a starter outline. Use them when asked.
- Charts plot over time (dateFieldId, bucket; kind line, area or bar) or by category (groupByFieldId; kind bar
  or donut). A reports page is a system with only widgets: stats for totals and several charts.
- Systems are the sidebar pages. Put an Overview system first with 3 to 6 widgets, then one page per area the
  owner manages day to day, usually 3 to 6 pages: each main record type (bookings, courts, players, clients,
  products, tasks…) gets its own page with its own views, e.g. "Bookings" (schedule and list), "Courts" (all
  courts), "Players" (all players). Views on one page are tabs of the same work. When the brief asks for a
  separate page (a calendar page, a pipeline page), make it its own system with that view, and don't repeat
  the view as a tab elsewhere. Line-item record types stay inside their parent's page.
  Every system lists at least one view or widget, and page names are short nouns.
- Money is PHP. Use realistic Filipino business details in samples, dated around today.
- Booking businesses: every amount on a booking is a money formula, never a field people type: the court fee is
  the rate times duration_hours(time) (e.g. hour(time.start) >= 17 ? court.evening_rate : court.day_rate), add-ons
  come from the add-on records, and the total adds them up. Public visitors never see or enter prices. Overview stats for a booking business: booked value (sum of amount, not cancelled),
  bookings (count), average booking value (avg of amount), paid (sum of amount where paid), outstanding (sum where
  unpaid); charts of booking value and booking volume over time.

${PUBLIC_PAGES_GUIDE}

The two examples below are valid blueprints from EveryOps's template library. Follow their conventions.`;
