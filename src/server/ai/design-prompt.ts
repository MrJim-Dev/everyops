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
    heading: z.string().describe("A few words"),
    subheading: z.string().optional().describe("One or two plain sentences, under 200 characters, no emoji"),
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
/** One step of a multi-step form. The designer's steps can also hold the add-ons; the assistant's can't. */
export const formStep = z.object({
  id: z.string(),
  title: z.string().describe("Short, e.g. Court and time, Your details"),
  description: z.string().optional(),
  fieldIds: z.array(z.string()).describe("This step's fields; each field in one step"),
});

export const view = z.union([
  z.object({
    ...viewBase,
    type: z.literal("table"),
    fieldIds: z.array(z.string()).describe("Columns"),
    filter,
    sort: z.array(sort).optional(),
    groupByFieldId: z
      .string()
      .optional()
      .describe(
        "Rows grouped by this select, status, relation, person or checkbox field, e.g. payment status",
      ),
    totals: z
      .boolean()
      .optional()
      .describe("A totals row for money and number columns, with group subtotals"),
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
    fieldIds: z
      .array(z.string())
      .optional()
      .describe(
        "Optional order fields the cashier also fills (table, note). Required order fields such as a branch are always asked",
      ),
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
    steps: z
      .array(
        formStep.extend({
          extras: z.boolean().optional().describe("This step shows the add-ons picker; it may ask no fields"),
        }),
      )
      .optional()
      .describe("A multi-step form: 2 to 4 steps asking a few fields each"),
    review: z.boolean().optional().describe("With steps: a summary to check before submitting"),
    intro: z.string().optional(),
    submitLabel: z
      .string()
      .optional()
      .describe("The button, 2 to 4 words, e.g. Book court. Instructions and payment details go in intro."),
    public: z.boolean().optional().describe("Anyone with the link can submit it (a public booking page)"),
    blocks: z.array(block).optional().describe("Shown with the form, e.g. active payment methods, FAQs"),
    extras: z
      .object({
        lineEntityId: z
          .string()
          .describe("Line items whose parent is this form's record type, e.g. booking_addon"),
        itemFieldId: z.string().describe("Their relation to the item picked, e.g. add_on"),
        quantityFieldId: z.string().optional().describe("Their number field for how many"),
        filter: z.string().optional().describe("Which items are offered, e.g. active == true"),
      })
      .optional()
      .describe("Add-ons people pick with a quantity (paddle rental, balls); each becomes a line item"),
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
  z.object({ ...viewBase, type: z.literal("canvas") }),
  z.object({
    ...viewBase,
    type: z.literal("html"),
    public: z.boolean().optional().describe("true only when the person wants it live now"),
    html: z
      .string()
      .optional()
      .describe(
        "A short starting page only when asked to draft one; the owner pastes or uploads their own design",
      ),
  }),
  z.object({
    ...viewBase,
    type: z.literal("landing"),
    public: z.boolean().optional(),
    blocks: z.array(block).describe("The public page, top to bottom"),
  }),
]);

/** A card's formula over named totals; shared with the workspace assistant. */
export const widgetCalc = z
  .object({
    terms: z
      .array(
        z.object({
          id: z.string().describe("snake_case name used in the formula, e.g. bookings"),
          entityId: z.string(),
          op: z.enum(["count", "sum", "avg"]),
          fieldId: z.string().optional().describe("sum and avg: a number or money field of that record type"),
          filter: z.string().optional().describe("Formula over that record type's fields"),
        }),
      )
      .describe("Named totals, each from one record type"),
    expr: z.string().describe("Arithmetic over the term ids, e.g. bookings + other_income - expenses"),
    format: z.enum(["money", "number", "percent"]).optional(),
  })
  .describe("A formula over named totals; use it to combine record types or do arithmetic");

export const widget = z.object({
  id: z.string(),
  title: z.string(),
  entityId: z.string(),
  filter: z.string().optional(),
  type: z.enum(["stat", "chart", "progress", "list", "agenda", "heatmap"]),
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
  calc: widgetCalc.optional().describe("stat or progress only: combine record types or do arithmetic"),
  list: z
    .object({
      fieldIds: z.array(z.string()),
      limit: z.number(),
      viewId: z.string().optional(),
      sort: z.array(sort).optional(),
    })
    .optional(),
  compare: z
    .object({
      dateFieldId: z.string().describe("A date, datetime or time_range field of the record type"),
      period: z
        .enum(["day", "week", "month"])
        .describe("today vs yesterday, last 7 or last 30 days vs the ones before"),
    })
    .optional()
    .describe("stat only (not with calc): the current period's value and the change from the period before"),
  sparkline: z.boolean().optional().describe("stat with compare: a small trend line of daily values"),
  agenda: z
    .object({
      dateFieldId: z.string().describe("A date, datetime or time_range field"),
      days: z.number().optional().describe("How many days ahead, today included; default 1"),
      fieldIds: z.array(z.string()).optional().describe("Up to 3 details shown per item"),
    })
    .optional()
    .describe("agenda only: today's schedule as a timeline"),
  heatmap: z
    .object({
      dateFieldId: z.string().describe("A datetime or time_range field with times"),
      weeks: z.number().optional().describe("Weeks to look back; default 8"),
    })
    .optional()
    .describe("heatmap only: weekday by hour, e.g. when courts or the shop are busiest"),
  width: z
    .enum(["third", "half", "two_thirds", "full"])
    .optional()
    .describe("Width on a dashboard with a layout; usually leave it to the layout"),
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
  layout: z
    .enum(["overview", "operations", "reports"])
    .optional()
    .describe(
      "Dashboard arrangement: overview (numbers, a wide trend, lists beside it), operations (today's agenda and queues first), reports (charts two to a row)",
    ),
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
  site: z
    .object({
      headline: z
        .string()
        .describe("The website's big line: 3 to 7 words about what customers get, not the business name"),
      intro: z
        .string()
        .describe("One or two plain sentences under the headline, under 180 characters, no emoji"),
      cta: z.string().describe("The main button, 2 to 4 words, e.g. Book a court"),
      offerTitle: z.string().describe("Heading over what's offered, e.g. Our courts or Rental items"),
      highlights: z
        .array(z.object({ title: z.string(), body: z.string() }))
        .describe(
          "Exactly 3 true, specific reasons to choose this business, from the brief (title a few words, body one sentence)",
        ),
      steps: z
        .array(z.object({ title: z.string(), body: z.string() }))
        .describe("3 steps for how a customer books or orders through the website"),
      contact: z
        .array(z.object({ kind: z.enum(["phone", "email", "address", "hours"]), value: z.string() }))
        .describe("Only contact details the brief or files actually give; empty if none"),
    })
    .optional()
    .describe(
      "The words of the public website. Only when the business has a public form or asked for a website.",
    ),
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
      "2 to 3 realistic sample records for every record type, including line items (2 to 3 lines under a parent sample, so its totals aren't zero) and day-to-day records like attendance, orders or payslips; up to 36 in total. Never give values for formula or rollup fields.",
    ),
});
export type Design = z.infer<typeof design>;

/*
 * What the designer is actually asked for: the same design without the optional decoration Gemini kept running away
 * in (a hero subheading, a form's button text, approval button labels and details, a target on a chart). It wrote
 * them as endless filler until the call timed out. The app fills them in when it tidies the design, and people can
 * change them afterwards.
 */
type Shape = z.ZodObject<z.ZodRawShape>;
const typeOf = (o: unknown) => ((o as Shape).shape.type as z.ZodLiteral<string>).value;
const lean = (
  options: readonly unknown[],
  drop: Record<string, Record<string, true>>,
  extend?: (t: string, o: Shape) => Shape,
) =>
  z.union(
    options.map((o) => {
      const t = typeOf(o);
      const slim = drop[t] ? (o as Shape).omit(drop[t]) : (o as Shape);
      return extend ? extend(t, slim) : slim;
    }) as unknown as [Shape, Shape, ...Shape[]],
  );
const designBlock = lean(block.options, { hero: { subheading: true } });
const designView = lean(
  view.options,
  {
    approval_queue: { approveLabel: true, rejectLabel: true, detailFieldIds: true },
    form: { submitLabel: true },
  },
  (t, o) =>
    t === "form"
      ? o.extend({ blocks: z.array(designBlock).optional() })
      : t === "landing"
        ? o.extend({ blocks: z.array(designBlock).describe("The public page, top to bottom") })
        : o,
);
const designWidget = (widget as unknown as Shape).omit({ target: true });
export const designRequest = (design as unknown as Shape).extend({
  views: z.array(designView),
  widgets: z.array(designWidget),
}) as unknown as typeof design;

/**
 * A repair's answer: only the parts it changes or adds, each whole, plus the ids it deletes. Writing back the whole
 * design took as long as the design itself (12–16k tokens, up to two minutes); a patch is a few hundred tokens.
 */
export const designPatch = (designRequest as unknown as Shape)
  .partial()
  .omit({ workspaceName: true, summary: true })
  .extend({
    remove: z
      .array(z.string())
      .optional()
      .describe(
        "Ids to delete: a record type (order), a field (order.discount), a view, widget, rule or sidebar section",
      ),
  }) as unknown as z.ZodType<DesignPatch>;
export type DesignPatch = Partial<Omit<Design, "workspaceName" | "summary">> & { remove?: string[] };

export const PATCH_INSTRUCTIONS = `Return only what changes, as a patch:
- Each record type, view, widget, rule or sidebar section you change or add, whole, with its id. A record type you
  return keeps any of its fields you leave out, so return only the fields you change or add.
- Leave everything else out: it stays exactly as it is.
- Ids to delete go in remove ("order" for a record type, "order.discount" for a field, or a view, widget, rule or
  section id). Delete only what a problem needs.
- Sample records only for record types you add.`;

/** How public pages, payments and FAQs are built. Shared by the designer and the workspace assistant. */
export const PUBLIC_PAGES_GUIDE = `Public pages (customers use them without an account, at /s/<workspace>/<view>):
- A public form is a form view with public true, e.g. a public booking page. Visitors see only its fields; statuses
  are set by the business (new submissions start at the first status option), so don't ask for them. Booking
  forms ask for the resource (court) and its time_range field; visitors pick a free slot, double bookings are
  refused. Bookings made publicly carry the guest's details as text fields on the booking (guest name, phone,
  email); a relation to people (players, clients) must not be required.
- The website: a business whose customers book, order or sign up on their own gets a public form (the booking form)
  and a website. At setup EveryOps builds that website as a custom HTML page, designed and filled in from the data
  and the words in site (hero, highlights, what's offered, how it works, payment methods, FAQs and contact), with
  buttons that open the booking form. When designing a workspace, don't add a landing or html view for it: write
  the website's words in site, and EveryOps builds the page. A website added later with the assistant uses the
  standard landing layout unless the person asks for HTML. Contact details come only from the brief or files;
  never invent a phone number or address.
- Booking forms can show their calendar three ways (the owner switches it on the form's page): a strip of days
  with that day's times, one day as a grid of every court or room side by side, or a month calendar. Stays and
  rentals of whole days always pick check-in and check-out on a month calendar.
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
and return the complete blueprint plus sample records. The owner's attached files (a menu photo, a price list, a staff
roster) may follow the brief: the brief decides what to build, and the files supply real names, items, prices and
sample records (use every menu item or price they show, up to 40 records per record type).

Formula language (formula.expr, freezeWhen, filters, rule conditions and values):
- Field references by id on the same record (rate, qty); through relation fields, up to three links:
  product.price, delivery.supplier.lead_days, crew_member.position.daily_rate. Every part before the last must be
  a relation field.
- Numbers, 'strings', true, false, null. Operators: + - * / % == != < <= > >= && || ! and cond ? a : b.
- Functions: ${Object.keys(FUNCTIONS).join(", ")}. hour/weekday read Asia/Manila time (weekday 0 = Sunday);
  duration_hours(range) and days(range) measure time ranges; is_today, is_this_month, is_upcoming test dates.
- Status and select values compare against option ids: status == 'done'.

Rules for a valid blueprint:
- Automations (rules) change other records when something happens. Totals records move (stock from deliveries,
  sales and stock movements; balances; leave days) are also connected automatically when a record type links to
  the record with the total and has a quantity or amount, so a missing one gets added. adjust_number adds a formula to a number
  field: on the record itself (target self) or on a linked one (target relation with the link's fieldId). Always
  set fieldId to the field it changes and delta to what it adds: receiving stock on a Stock Delivery with product
  and quantity is trigger created on the delivery, target relation product, fieldId stock, delta quantity (or
  quantity * product.pack_size); a sale line is delta -qty. Use trigger created for these: the app keeps them in
  step when the record is edited or deleted, and a when condition (status == 'received') makes it count only
  while true. Never adjust_number on updated (it would count again on every edit).
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
  The Register fills the order's code, date, status, totals, cash, change, cashier and customer itself, and asks
  the cashier for every other required order field (a branch, a table), so a multi-branch store makes branch a
  required relation on the order and it shows up on the Register.
- form views are a page that is just the form to add one record type (fieldIds, intro). notes views
  are a notebook over a record type with a text title and a long_text body (titleFieldId, bodyFieldId).
  document views are one free markdown page with entityId "" and a starter outline. canvas views are a free
  whiteboard (shapes, text, sticky notes, arrows, pictures) with entityId "", for a floor plan, mood board,
  layout or process map. html views are a page the owner designs in their own HTML (entityId ""); add one only
  when asked for a custom HTML page. Use them when asked.
- Charts plot over time (dateFieldId, bucket; kind line, area or bar) or by category (groupByFieldId; kind bar
  or donut). A reports page is a system with only widgets: stats for totals and several charts.
- A stat that combines record types or needs arithmetic (total income = bookings + other income, profit,
  collection rate) uses calc: named terms (count/sum/avg of one record type with its own filter) and expr over
  their ids, e.g. "bookings + other_income"; format percent for rates.
- Dashboards: give every system that holds widgets a layout: overview for the Overview page, operations for a
  front desk or daily-work page, reports for a page of charts. Stats on an Overview usually compare periods
  (compare with the record's date field, period day for daily work, week or month otherwise) with sparkline true;
  their filter then leaves out the date, e.g. status == 'paid' rather than is_today(slot) && status == 'paid'.
  Businesses with a schedule (bookings, shifts, appointments, posts) get an agenda widget of today, and businesses
  with times of day (bookings, sales, orders) get a heatmap of busy hours.
- Tables of money (bookings, orders, expenses) set totals true; a list that people sort into states (payment,
  approval, stage) can set groupByFieldId to that field.
- Forms that ask more than 5 fields, every public booking form and every form with add-ons use steps (e.g. Court
  and time, Add-ons with extras true and no fields, Your details, Payment) with review true. Each field goes in
  exactly one step.
- Systems are the sidebar pages. Put an Overview system first with 3 to 6 widgets, then one page per area the
  owner manages day to day, usually 3 to 6 pages: each main record type (bookings, courts, players, clients,
  products, tasks…) gets its own page with its own views, e.g. "Bookings" (schedule and list), "Courts" (all
  courts), "Players" (all players). Views on one page are tabs of the same work. When the brief asks for a
  separate page (a calendar page, a pipeline page), make it its own system with that view, and don't repeat
  the view as a tab elsewhere. Line-item record types stay inside their parent's page.
  Every system lists at least one view or widget, and page names are short nouns.
- Money is PHP. Use realistic Filipino business details in samples, dated around today.
- Keep every text short: names and labels a few words, intros one sentence, text blocks and starter pages under
  120 words. Never repeat yourself.
- Booking businesses: every amount on a booking is a money formula, never a field people type: the court fee is
  the rate times duration_hours(time) (e.g. hour(time.start) >= 17 ? court.evening_rate : court.day_rate), add-ons
  come from the add-on records, and the total adds them up. Public visitors never see or enter prices. Overview stats for a booking business: booked value (sum of amount, not cancelled),
  bookings (count), average booking value (avg of amount), paid (sum of amount where paid), outstanding (sum where
  unpaid); charts of booking value and booking volume over time.
- Add-ons and things sold with a booking or order (paddle rental, balls, towels, extra hour): an add-ons record type
  (name, price, unit such as per hour or per piece, active checkbox) and booking add-ons line items with parent the
  booking: a relation to the booking, a relation to the add-on, qty (number, required) and line_total (money
  formula add_on.price * qty). The booking gets add_ons_total (rollup sum of line_total) and its total adds it. The
  public form sets extras (lineEntityId booking_addon, itemFieldId add_on, quantityFieldId qty, filter
  "active == true") so visitors pick add-ons with quantities.
- Think ahead like a consultant who has set up many businesses like this one: build what they will need on day one
  even when the brief doesn't spell it out (a public booking page, payment methods, add-ons, a customer list,
  reports), guided by the references that follow the brief. Never build more than the business can use.

${PUBLIC_PAGES_GUIDE}

The two examples below are valid blueprints from EveryOps's template library. Follow their conventions.`;

/**
 * How EveryOps writes custom HTML pages: Emil Kowalski's design engineering rules (purposeful, fast, interruptible
 * motion and the small details people feel), short enough to sit in a prompt.
 */
export const HTML_DESIGN_GUIDE = `Design custom HTML pages the way Emil Kowalski would (simple, clean, polished):
    - One clear headline, a short lead and one primary action ("Book a court") repeated at the top, after "How it
      works" and in the footer; generous spacing, a readable measure (about 60 characters), 2 to 3 colors.
    - Motion only where it explains or confirms: sections fade in with 8px of rise as they scroll into view, a short
      30 to 80 ms stagger, and nothing waits for an animation. Never animate from scale(0); start at opacity 0 and
      scale(0.95) or translateY(8px).
    - Easing: a strong ease-out, cubic-bezier(0.23, 1, 0.32, 1), for entrances and presses; ease-in-out only for
      things moving on screen; never ease-in. Durations: presses 100 to 160 ms, small popovers 150 to 200 ms, UI under
      300 ms.
    - Buttons and cards answer presses with transform: scale(0.97). Transition exact properties (transform,
      opacity, background-color), never "all"; animate only transform and opacity.
    - Hover effects only inside @media (hover: hover) and (pointer: fine). Respect prefers-reduced-motion: keep the
      fades, drop the movement. Visible :focus-visible outlines, real buttons and links, alt text on pictures.`;
