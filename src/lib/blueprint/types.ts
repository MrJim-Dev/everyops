/**
 * Blueprint: the typed description of every system inside a workspace.
 * One generic engine and one set of views render any blueprint, so a client
 * "system" is configuration only. Shapes follow the EveryOps design spec §4.
 */

export type IconName =
  | "calendar"
  | "court"
  | "users"
  | "user"
  | "receipt"
  | "storefront"
  | "package"
  | "chart"
  | "wallet"
  | "megaphone"
  | "image"
  | "briefcase"
  | "airplane"
  | "house"
  | "key"
  | "gauge";

export type Tone = "neutral" | "accent" | "warning" | "danger" | "success";

export type FieldType =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "percent"
  /** A score from 1 to 5, shown as stars (a review, a service rating, a lead's priority). */
  | "rating"
  /** A length of time in minutes, shown as "1 h 30 min" (a session, a repair, time on a task). */
  | "duration"
  | "date"
  | "datetime"
  | "time_range"
  | "select"
  | "multi_select"
  | "status"
  | "person"
  | "relation"
  | "checkbox"
  /** An uploaded picture (a QR code, a logo). The value is the app path that serves it. */
  | "image"
  /** An email address, a phone number, a web address: text that's checked and opens as a link. */
  | "email"
  | "phone"
  | "url"
  /** An uploaded document (a PDF receipt, a contract): the app path, with its name, served only to the team. */
  | "file"
  /**
   * A drawn signature (a waiver, a rental agreement, a delivery receipt): a PNG in the workspace's private documents,
   * like a file field's, served only to the team. Signed on a pad in the app or on a public form.
   */
  | "signature"
  | "formula"
  | "rollup"
  /** Who added the record (a person, a public form, an automation, an API key), stamped by EveryOps. */
  | "created_by"
  /** Who changed the record last, stamped by EveryOps on every save. */
  | "edited_by";

export type FieldOption = { id: string; label: string; tone: Tone };

export type Field = {
  id: string;
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string;
  options?: FieldOption[];
  /** For time_range fields: whole days (stays, leave) or clock times (bookings). Defaults to "times". */
  range?: "dates" | "times";
  relation?: { entityId: string };
  formula?: {
    expr: string;
    resultType: "number" | "money" | "text" | "checkbox" | "date";
    /** When true for a record, its stored value is kept as is (e.g. paid bookings). */
    freezeWhen?: string;
  };
  rollup?: {
    childEntityId: string;
    viaFieldId: string;
    op: "sum" | "count" | "min" | "max" | "avg";
    fieldId?: string;
    /** Only the child records this formula is true for, e.g. status == "paid". */
    filter?: string;
  };
};

export type Entity = {
  id: string;
  name: string;
  pluralName: string;
  primaryFieldId: string;
  fields: Field[];
  parent?: { entityId: string; fieldId: string };
  booking?: {
    resourceFieldId: string;
    timeFieldId: string;
    statusFieldId: string;
    blockingStatuses: string[];
  };
  resource?: {
    opensAt: string;
    closesAt: string;
    slotMinutes: 15 | 30 | 60 | 90 | 120;
  };
  /**
   * Staff and viewers see only their own records of this type: by is the field naming them (a person or email field
   * holding their name or email), or "created_by" for the records they added (src/lib/engine/access.ts).
   * Without it everyone in the workspace sees every record.
   */
  access?: { by: string };
};

export type Sort = { fieldId: string; dir: "asc" | "desc" };

type ViewBase = { id: string; entityId: string; name: string };

export type TableView = ViewBase & {
  type: "table";
  fieldIds: string[];
  filter?: string;
  sort?: Sort[];
  /** Rows grouped under collapsible headers by this select, status, relation, person or checkbox field. */
  groupByFieldId?: string;
  /** A totals row for number and money columns (and subtotals on each group). */
  totals?: boolean;
  /**
   * Shared as public data: public custom HTML pages may read this view's rows (its filter and sort, only fields that
   * don't identify people or show the team's costs) through EveryOps.data. Never on record types about people.
   */
  publicData?: boolean;
};
export type KanbanView = ViewBase & {
  type: "kanban";
  statusFieldId: string;
  cardFieldIds: string[];
  filter?: string;
};
export type CalendarView = ViewBase & {
  type: "calendar";
  dateFieldId: string;
  titleFieldId: string;
  filter?: string;
};
export type SlotGridView = ViewBase & { type: "slot_grid" };
export type CheckoutView = ViewBase & {
  type: "checkout";
  productEntityId: string;
  lineEntityId: string;
  paymentFieldId: string;
  /**
   * Optional order fields the Register also asks (a note, a table). Required order fields a sale can't fill by
   * itself, such as a branch, are always asked, listed here or not.
   */
  fieldIds?: string[];
};
export type ApprovalQueueView = ViewBase & {
  type: "approval_queue";
  statusFieldId: string;
  pending: string;
  approve: string;
  reject: string;
  /** Button verbs, e.g. "Approve" and "Decline". */
  approveLabel: string;
  rejectLabel: string;
  detailFieldIds: string[];
};
/**
 * One page of a multi-step form: a title and the fields it asks. A step with extras shows the add-ons picker, and
 * blockIds shows some of the form's blocks in the step instead of below the form (payment methods on the payment step).
 */
export type FormStep = {
  id: string;
  title: string;
  description?: string;
  fieldIds: string[];
  extras?: boolean;
  blockIds?: string[];
};

/** A page that is just the form for adding one record type, e.g. a booking form for the front desk. */
export type FormView = ViewBase & {
  type: "form";
  /** Fields in the order they're asked; empty means every editable field. */
  fieldIds: string[];
  /** Ask the fields a few at a time, with Back and Next. Each field belongs to one step. */
  steps?: FormStep[];
  /** With steps: show a summary to check before submitting. */
  review?: boolean;
  intro?: string;
  submitLabel?: string;
  /** Anyone with the link can submit it (a public booking page), at /s/[workspace]/[view]. */
  public?: boolean;
  /**
   * Booking forms: a visitor may pick several slots in a row (two or three hours) as one booking. On unless set to
   * false, which limits each booking to one slot.
   */
  multipleSlots?: boolean;
  /**
   * Booking forms: how visitors pick when. "days": a strip of days with that day's times (the default). "grid": one
   * day as a grid of every resource's times (courts side by side). "month": a month calendar, then the day's times.
   * Bookings of whole days (stays, rentals) always pick a date range on a month calendar.
   */
  bookingLayout?: BookingLayout;
  /** Shown with the form, e.g. the active payment methods or FAQs. */
  blocks?: Block[];
  /** Things people add with a quantity (paddle rental, balls): each becomes a line item on the new record. */
  extras?: FormExtras;
  /**
   * A public custom HTML page that is this form's face to visitors (a custom booking page). The form still checks
   * and saves what that page sends; its own address redirects to the page, and the site's buttons open the page.
   */
  page?: string;
};

/**
 * Add-ons on a form. Line items live in a record type whose parent is the form's record type (booking add-ons under
 * a booking); people pick from the record type its item field links to (add-ons), filtered (e.g. active ones).
 */
export type FormExtras = {
  /** The line-item record type, e.g. booking_addon. */
  lineEntityId: string;
  /** Its link to the item picked, e.g. add_on. */
  itemFieldId: string;
  /** Its number field for how many, e.g. qty. */
  quantityFieldId?: string;
  title?: string;
  /** Which items are offered, e.g. active == true. */
  filter?: string;
};
/** A notebook over one record type: a list of notes beside a markdown editor for the selected one. */
export type NotesView = ViewBase & {
  type: "notes";
  titleFieldId: string;
  /** A long_text field holding markdown. */
  bodyFieldId: string;
  /** Extra fields shown under each note's title, e.g. a tag or a date. */
  metaFieldIds?: string[];
};
/** A free page of markdown. It has no record type: entityId is "", and the text lives in the workspace's docs. */
export type DocumentView = ViewBase & {
  type: "document";
  /** Markdown shown until someone edits the page. */
  starter?: string;
};
/**
 * A free canvas (whiteboard): shapes, text, sticky notes, arrows and pictures people arrange by hand, e.g. a floor
 * plan, a mood board or a process map. entityId is "", and the drawing lives in the workspace's docs as JSON.
 */
export type CanvasView = ViewBase & { type: "canvas" };
/** A public web page (a landing page) built from blocks that can show live data. entityId is "". */
export type LandingView = ViewBase & {
  type: "landing";
  /** Public unless switched off. */
  public?: boolean;
  blocks: Block[];
  /** "standard": built from EveryOps's site template (same sections and look for every business). */
  layout?: "standard";
};
/**
 * A page the owner designs entirely in HTML and CSS: a custom landing page, booking or sign-up form, or
 * instructions. entityId is "". The page lives in the workspace's docs under the view id; `html` is what it starts
 * with. It runs in a sandboxed frame and can send forms to the workspace's public forms (src/lib/public/html-page.ts).
 */
export type HtmlPageView = ViewBase & {
  type: "html";
  /** Shown at /s/[workspace]/[view] once published (private until then). */
  public?: boolean;
  html?: string;
  /**
   * A website setup made: the sections its live parts (<!--everyops:live id--> … ) are drawn from, again every time
   * the page is shown, so its prices, services and payment methods are always the workspace's current ones.
   */
  live?: { blocks: Block[] };
};

/**
 * One part of a layout page: a component from the component library (src/lib/components/registry.ts) with its
 * settings. span is how many of the section's columns it covers on wide screens; on phones everything stacks.
 */
export type LayoutItem = { id: string; component: string; span?: number; props: Record<string, unknown> };

/** A row of a layout page: an optional heading, then its items in a grid of 1 to 4 columns. */
export type LayoutSection = {
  id: string;
  title?: string;
  description?: string;
  columns: number;
  items: LayoutItem[];
};

/**
 * A page composed from the component library: stats, charts, tables, lists, calendars, cards, tabs, blocks and the
 * workspace's own views and dashboard cards, arranged in sections. entityId is "": each component names its own
 * record type. Validated against the registry like every other part of the blueprint.
 */
export type LayoutView = ViewBase & {
  type: "layout";
  sections: LayoutSection[];
  /**
   * Shown to anyone at /s/[workspace]/[view]. Visitors get only what each component works out on the server (numbers,
   * chart points, the fields a list names), never records; components that would show people are refused.
   */
  public?: boolean;
};

/** A short titled point: a highlight ("Open until 11 PM") or a step ("Pick a court and time"). */
export type BlockItem = { title: string; body: string };

/**
 * Pieces of a public page. Text in hero, text and html blocks can be edited in the app (kept in the workspace's
 * docs); records blocks show live data, only the fields they list, filtered.
 */
export type Block =
  | { id: string; type: "hero"; heading: string; subheading?: string; ctaLabel?: string; ctaViewId?: string }
  | { id: string; type: "text"; markdown: string }
  | {
      id: string;
      type: "records";
      title?: string;
      entityId: string;
      filter?: string;
      fieldIds: string[];
      /** cards (images shown large, e.g. payment QR codes), list, table, or faq (question then answer). */
      layout: "cards" | "list" | "table" | "faq";
      sort?: Sort[];
      limit?: number;
    }
  | { id: string; type: "form"; viewId: string; title?: string }
  /** Three or four short reasons to choose the business. */
  | { id: string; type: "highlights"; title?: string; items: BlockItem[] }
  /** How booking or ordering works, in order. */
  | { id: string; type: "steps"; title?: string; items: BlockItem[] }
  /** Where and how to reach the business. */
  | {
      id: string;
      type: "contact";
      title?: string;
      phone?: string;
      email?: string;
      address?: string;
      hours?: string;
    }
  /** Raw HTML, shown in a sandboxed frame so it can't touch the app or visitors' sessions. */
  | { id: string; type: "html"; html: string };

export type View =
  | TableView
  | KanbanView
  | CalendarView
  | SlotGridView
  | CheckoutView
  | ApprovalQueueView
  | FormView
  | NotesView
  | DocumentView
  | CanvasView
  | LandingView
  | HtmlPageView
  | LayoutView;

export type ViewType = View["type"];

/** Pages with no record type of their own (entityId ""). */
export const FREE_PAGE_TYPES: ReadonlySet<string> = new Set([
  "document",
  "canvas",
  "html",
  "landing",
  "layout",
]);

/** A named total a summary card's formula uses: one record type, counted or added up, with its own filter. */
export type WidgetTerm = {
  id: string;
  entityId: string;
  op: "count" | "sum" | "avg";
  fieldId?: string;
  filter?: string;
};

/**
 * Stat and progress cards: the value is a formula over named totals instead of one metric, so a card can
 * combine record types or do arithmetic, e.g. "bookings + other_income" or "paid / all * 100".
 */
export type WidgetCalc = {
  expr: string;
  terms: WidgetTerm[];
  /** How to show the result. Defaults to money when a term adds up a money field. */
  format?: "money" | "number" | "percent";
};

export type Widget = {
  id: string;
  title: string;
  entityId: string;
  filter?: string;
  type: "stat" | "chart" | "progress" | "list" | "agenda" | "heatmap";
  metric: { op: "count" | "sum" | "avg"; fieldId?: string };
  /** Stat and progress only. When set, it replaces entityId, filter and metric for the value. */
  calc?: WidgetCalc;
  chart?: {
    kind: "line" | "bar" | "area" | "donut";
    /** Over time: buckets by this date field. */
    dateFieldId?: string;
    bucket: "day" | "week" | "month";
    /** By category instead of over time: one bar or slice per option or linked record. Donuts need it. */
    groupByFieldId?: string;
    /** Optional second series, e.g. expenses next to revenue. */
    splitByFieldId?: string;
  };
  target?: number;
  /** For list widgets: which fields to show, their order, and where "View all" goes. */
  list?: { fieldIds: string[]; limit: number; viewId?: string; sort?: Sort[] };
  /**
   * Stats only: show the value for the current period (today, the last 7 or 30 days) next to the period before,
   * by the records' date field, e.g. "₱12,400, up 18% vs the previous 7 days".
   */
  compare?: { dateFieldId: string; period: "day" | "week" | "month" };
  /** Stats with compare only: a small line of the daily values behind the number. */
  sparkline?: boolean;
  /** Agenda widgets: what's coming up, grouped by day and sorted by time. */
  agenda?: { dateFieldId: string; days?: number; fieldIds?: string[] };
  /** Heatmap widgets: weekday by hour of the day, e.g. when courts are busiest, over the last few weeks. */
  heatmap?: { dateFieldId: string; weeks?: number };
  /** Layout hint for dashboards. Defaults: charts in the main column, lists and progress at the side. */
  span?: "main" | "side";
  /** Width in a dashboard with a layout. Defaults come from the layout. */
  width?: WidgetWidth;
};

export type WidgetWidth = "third" | "half" | "two_thirds" | "full";

/**
 * Premade dashboard arrangements. overview: key numbers, a wide trend, lists beside it. operations: today's agenda
 * first, then queues and lists. reports: charts two to a row.
 */
export type DashboardLayout = "overview" | "operations" | "reports";

export type Target = { kind: "self" } | { kind: "relation"; fieldId: string };

export type Action =
  | { type: "set_field"; target: Target; fieldId: string; value: string }
  | { type: "adjust_number"; target: Target; fieldId: string; delta: string }
  | { type: "notify"; message: string }
  /**
   * Emails someone, sent by the server after the record is saved (or when a timed automation runs). to, subject
   * and body are text with {{field}} placeholders, which can go through links ({{player.email}}).
   */
  | { type: "send_email"; to: string; subject: string; body: string }
  /**
   * Adds a record of another type, e.g. an invoice when a booking is confirmed. values maps its field ids to
   * formulas read on the triggering record; a link back to the triggering record's type is filled in by itself.
   */
  | { type: "create_record"; entityId: string; values: Record<string, string> }
  /**
   * Files the record under the record of another type that matches it, adding that record when there's none yet:
   * an activity log under the daily summary for its date, a meter reading under its month's bill. target is the link
   * on this record to fill, fieldId the field of the linked type to match, and value a formula on this record for
   * what it must equal (date). The linked type's rollups then count through that link.
   */
  | { type: "link_record"; target: { kind: "relation"; fieldId: string }; fieldId: string; value: string }
  /**
   * Calls an outside service: posts to one of the workspace's webhook endpoints (Settings → Webhooks, where its URL
   * and signing secret stay, out of the blueprint). body is JSON with {{field}} placeholders inside its strings,
   * e.g. {"text": "New booking: {{name}} at {{time}}"}; without one it sends the record. Sent by the server, with
   * the endpoint's retries, like emails.
   */
  | { type: "call_api"; endpointId: string; body?: string };

/** When a timed automation runs, in Manila time. */
export type RuleSchedule = {
  every: "day" | "week" | "month";
  /** "HH:MM", 24-hour. */
  at: string;
  /** every week: 0 = Sunday … 6 = Saturday. */
  weekday?: number;
  /** every month: day 1 to 28. */
  monthDay?: number;
};

export type Rule = {
  id: string;
  name: string;
  /** Off when false: the automation stays in the design but does nothing. */
  enabled?: boolean;
  trigger: {
    entityId: string;
    /**
     * created / updated / status_changed run when a record is saved. schedule runs at set times for every record
     * that matches when. date_reached runs once per record, offsetDays from its date field (fieldId), at at.
     */
    event: "created" | "updated" | "status_changed" | "schedule" | "date_reached";
    fieldId?: string;
    to?: string;
    schedule?: RuleSchedule;
    /** date_reached: days after the date (negative is before, -1 is the day before). */
    offsetDays?: number;
    /** date_reached: the time of day it runs, "HH:MM" (default 08:00). */
    at?: string;
  };
  when?: string;
  actions: Action[];
  /**
   * If / else: after actions, the first branch whose when holds runs its actions too; a last branch without a when
   * is the otherwise (src/lib/engine/branches.ts). Older rules have none.
   */
  branches?: RuleBranch[];
};

/** One way an automation can go: its condition (a formula on the record) and what it does then. */
export type RuleBranch = { when?: string; actions: Action[] };

export type System = {
  id: string;
  name: string;
  icon: IconName;
  viewIds: string[];
  widgetIds: string[];
  /** The sidebar group it's listed under ("Front desk", "Money"), named by the owner. Without one it's listed on its own. */
  group?: string;
  /** How the dashboard arranges its widgets. Without one, charts go left and lists right. */
  layout?: DashboardLayout;
};

export type Blueprint = {
  version: number;
  workspaceName: string;
  systems: System[];
  entities: Entity[];
  views: View[];
  widgets: Widget[];
  rules: Rule[];
  /** ISO 4217 code money reads in (PHP, USD, SGD). Amounts are plain numbers; older blueprints mean PHP. */
  currency?: string;
  /** The IANA time zone the workspace's dates, schedules and "today" are read in. Older blueprints mean Asia/Manila. */
  timeZone?: string;
  /** Printable documents (invoices, quotes, agreements). Older blueprints have none. */
  printTemplates?: PrintTemplate[];
};

/** Paper a print template is laid out for: A4, US Letter, or an 80 mm receipt roll. */
export type PaperSize = "a4" | "letter" | "receipt";

/**
 * A printable document for one record type, written in markdown with {{placeholders}}: {{field}}, {{link.field}},
 * {{business}}, {{today}}, and {{lines}} (or {{lines:child}}) for a table of the record's line items.
 */
export type PrintTemplate = {
  id: string;
  entityId: string;
  name: string;
  body: string;
  paper?: PaperSize;
};

/* ---------- Records ---------- */

export type TimeRange = { start: string; end: string };

export type FieldValue = string | number | boolean | null | string[] | TimeRange;

export type RecordData = Record<string, FieldValue>;

export type DataRecord = {
  id: string;
  entityId: string;
  data: RecordData;
  createdAt: string;
  updatedAt: string;
  /** Who added it and who changed it last, as the server stamped them. Older records have none. */
  createdBy?: RecordActor;
  updatedBy?: RecordActor;
};

/** Who wrote a record: its kind (person, form, automation, api, agent, sync, visitor), its id, and how it reads. */
export type RecordActor = { type: string; id?: string | null; name: string };

export type WorkspaceData = {
  blueprint: Blueprint;
  records: DataRecord[];
};

export type BookingLayout = "days" | "grid" | "month";
export const BOOKING_LAYOUTS: BookingLayout[] = ["days", "grid", "month"];
