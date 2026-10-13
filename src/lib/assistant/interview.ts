/**
 * Setup interview for Ask EveryOps. In this frontend build the interviewer is
 * scripted; the shapes (profile, steps, questions) are what the Gemini
 * Interviewer will fill in later, so the UI does not change when it lands.
 */
import type { WorkspaceData } from "@/lib/blueprint/types";
import { CATALOG, type CatalogSystem } from "@/lib/catalog";

export type BusinessKind = "booking" | "pos" | "social" | "finance" | "hris" | "unknown";

export type Choice = { id: string; label: string };

export type Question =
  | { id: string; kind: "choice"; label: string; choices: Choice[]; suggested: string }
  | { id: string; kind: "hours"; label: string; suggested: { opens: string; closes: string } }
  | { id: string; kind: "text"; label: string; placeholder: string; suggested: string }
  | { id: string; kind: "money"; label: string; suggested: number };

export type Step = { id: string; title: string; intro: string; questions: Question[] };

export type Answers = Record<string, string | number | { opens: string; closes: string }>;

const KIND_PATTERNS: [BusinessKind, RegExp][] = [
  [
    "booking",
    /court|pickleball|tennis|badminton|basketball|booking|book|reserv|rental|rent|studio|room|resort|venue|salon|appointment/i,
  ],
  ["pos", /pos|register|canteen|store|sari|cafe|café|restaurant|sell|shop|carinderia|kiosk/i],
  ["social", /social|content|instagram|facebook|tiktok|posts?|marketing/i],
  ["finance", /financ|expense|income|budget|sales tracker|ledger|accounting|money/i],
  ["hris", /hr|leave|employee|staff|payroll|attendance|team/i],
];

export function detectKind(prompt: string): BusinessKind {
  return KIND_PATTERNS.find(([, re]) => re.test(prompt))?.[0] ?? "unknown";
}

export function suggestedSystem(kind: BusinessKind): CatalogSystem | undefined {
  const category = kind === "social" ? "social" : kind === "unknown" ? undefined : kind;
  return CATALOG.find((s) => s.category === category);
}

/** What the person books, guessed from their words; refined by the first question. */
function guessUnit(prompt: string): string {
  if (/room|resort|hotel|stay/i.test(prompt)) return "room";
  if (/studio/i.test(prompt)) return "studio";
  return "court";
}

/** "…with 6 courts" → "6". Falls back to 4 when the prompt doesn't say. */
function countFrom(prompt: string): string {
  const match = /(\d+)\s*(courts?|rooms?|studios?|units?)/i.exec(prompt);
  return match && ["2", "4", "6", "8"].includes(match[1]) ? match[1] : "4";
}

export function bookingSteps(prompt: string): Step[] {
  return [
    {
      id: "basics",
      title: "Your venue",
      intro: "Let's start with what people book.",
      questions: [
        {
          id: "name",
          kind: "text",
          label: "What's the business called?",
          placeholder: "Court House PH",
          suggested: "My venue",
        },
        {
          id: "unit",
          kind: "choice",
          label: "What do people book?",
          choices: [
            { id: "court", label: "Courts" },
            { id: "room", label: "Rooms" },
            { id: "studio", label: "Studios" },
          ],
          suggested: guessUnit(prompt),
        },
        {
          id: "count",
          kind: "choice",
          label: "How many can be booked at once?",
          choices: ["2", "4", "6", "8"].map((n) => ({ id: n, label: n })),
          suggested: countFrom(prompt),
        },
      ],
    },
    {
      id: "booking",
      title: "Booking details",
      intro: "A few details to set up your booking system.",
      questions: [
        {
          id: "duration",
          kind: "choice",
          label: "How long is a booking?",
          choices: [
            { id: "30", label: "30 minutes" },
            { id: "60", label: "1 hour" },
            { id: "120", label: "2 hours" },
          ],
          suggested: "60",
        },
        {
          id: "hours",
          kind: "hours",
          label: "When are you open?",
          suggested: { opens: "06:00", closes: "23:00" },
        },
        {
          id: "payment",
          kind: "choice",
          label: "How do players pay?",
          choices: [
            { id: "full", label: "Full payment" },
            { id: "deposit", label: "Deposit" },
            { id: "venue", label: "At the venue" },
          ],
          suggested: "full",
        },
      ],
    },
    {
      id: "rates",
      title: "Rates",
      intro: "Last step: what you charge.",
      questions: [
        { id: "rate", kind: "money", label: "Standard rate per hour", suggested: 400 },
        {
          id: "peak",
          kind: "choice",
          label: "Do evenings cost more?",
          choices: [
            { id: "no", label: "Same rate all day" },
            { id: "yes", label: "Higher from 5 to 10 PM" },
          ],
          suggested: "no",
        },
        { id: "peak_rate", kind: "money", label: "Evening rate per hour", suggested: 520 },
      ],
    },
  ];
}

export function suggestedAnswers(steps: Step[]): Answers {
  return Object.fromEntries(steps.flatMap((s) => s.questions.map((q) => [q.id, q.suggested])));
}

const UNIT_NAMES: Record<string, [string, string]> = {
  court: ["Court", "Courts"],
  room: ["Room", "Rooms"],
  studio: ["Studio", "Studios"],
};

export type ProfileLine = { label: string; value: string };

/** Human-readable profile shown in the right rail as answers come in. */
export function profileLines(answers: Answers): ProfileLine[] {
  const lines: ProfileLine[] = [];
  const unit = UNIT_NAMES[String(answers.unit ?? "court")] ?? UNIT_NAMES.court;
  if (answers.name) lines.push({ label: "Business", value: String(answers.name) });
  if (answers.count) lines.push({ label: unit[1], value: String(answers.count) });
  if (answers.duration)
    lines.push({
      label: "Booking length",
      value: answers.duration === "60" ? "1 hour" : answers.duration === "120" ? "2 hours" : "30 minutes",
    });
  const hours = answers.hours as { opens: string; closes: string } | undefined;
  if (hours) lines.push({ label: "Open", value: `${hours.opens} – ${hours.closes}` });
  if (answers.payment)
    lines.push({
      label: "Payment",
      value:
        { full: "Full payment", deposit: "Deposit", venue: "At the venue" }[String(answers.payment)] ?? "",
    });
  if (answers.rate) lines.push({ label: "Rate", value: `₱${answers.rate} per hour` });
  if (answers.peak === "yes") lines.push({ label: "Evening rate", value: `₱${answers.peak_rate} per hour` });
  return lines;
}

/**
 * The Architect step: turns answers into a blueprint. Courts become a
 * resource with opening hours, the rate becomes a formula, and the payment
 * style decides which statuses block a slot.
 */
export function buildBookingWorkspace(answers: Answers, now: Date): WorkspaceData {
  const [unit, units] = UNIT_NAMES[String(answers.unit)] ?? UNIT_NAMES.court;
  const unitId = String(answers.unit ?? "court");
  const hours = (answers.hours as { opens: string; closes: string }) ?? { opens: "06:00", closes: "23:00" };
  const slot = Number(answers.duration ?? 60) as 30 | 60 | 120;
  const rate = Number(answers.rate ?? 400);
  const rateExpr =
    answers.peak === "yes"
      ? `hour(slot) >= 17 && hour(slot) < 22 ? ${Number(answers.peak_rate ?? rate)} : ${rate}`
      : String(rate);
  const deposit = answers.payment === "deposit";
  const statusOptions: [string, string, "warning" | "accent" | "success" | "neutral"][] = [
    ["unpaid", answers.payment === "venue" ? "Pay at venue" : "Unpaid", "warning"],
    ...(deposit ? [["deposit", "Deposit paid", "accent"] as [string, string, "accent"]] : []),
    ["paid", "Paid", "success"],
    ["cancelled", "Cancelled", "neutral"],
  ];
  const name = String(answers.name || "My venue");
  const stamp = now.toISOString();
  const count = Number(answers.count ?? 4);

  return {
    blueprint: {
      version: 1,
      workspaceName: name,
      systems: [
        {
          id: "overview",
          name: "Overview",
          icon: "gauge",
          viewIds: [],
          widgetIds: ["bookings_today", "revenue_today", "unpaid_today", "unpaid_list"],
        },
        {
          id: "bookings",
          name: "Bookings",
          icon: "calendar",
          viewIds: ["schedule", "all_bookings"],
          widgetIds: [],
        },
        {
          id: `${unitId}s`,
          name: units,
          icon: unitId === "court" ? "court" : "house",
          viewIds: ["resources_table"],
          widgetIds: [],
        },
        { id: "customers", name: "Customers", icon: "users", viewIds: ["customers_table"], widgetIds: [] },
      ],
      entities: [
        {
          id: "resource",
          name: unit,
          pluralName: units,
          primaryFieldId: "name",
          resource: { opensAt: hours.opens, closesAt: hours.closes, slotMinutes: slot },
          fields: [
            { id: "name", name: "Name", type: "text", required: true },
            {
              id: "bookings",
              name: "Bookings",
              type: "rollup",
              rollup: { childEntityId: "booking", viaFieldId: "resource", op: "count" },
            },
          ],
        },
        {
          id: "customer",
          name: "Customer",
          pluralName: "Customers",
          primaryFieldId: "name",
          fields: [
            { id: "name", name: "Name", type: "text", required: true },
            { id: "phone", name: "Phone", type: "text" },
            {
              id: "visits",
              name: "Bookings",
              type: "rollup",
              rollup: { childEntityId: "booking", viaFieldId: "customer", op: "count" },
            },
          ],
        },
        {
          id: "booking",
          name: "Booking",
          pluralName: "Bookings",
          primaryFieldId: "customer_name",
          booking: {
            resourceFieldId: "resource",
            timeFieldId: "slot",
            statusFieldId: "status",
            blockingStatuses: statusOptions.filter(([id]) => id !== "cancelled").map(([id]) => id),
          },
          fields: [
            {
              id: "customer_name",
              name: "Booking",
              type: "formula",
              formula: { expr: "customer.name", resultType: "text" },
            },
            {
              id: "customer",
              name: "Customer",
              type: "relation",
              relation: { entityId: "customer" },
              required: true,
            },
            {
              id: "resource",
              name: unit,
              type: "relation",
              relation: { entityId: "resource" },
              required: true,
            },
            { id: "slot", name: "Time", type: "time_range", required: true },
            {
              id: "status",
              name: "Payment",
              type: "status",
              required: true,
              options: statusOptions.map(([id, label, tone]) => ({ id, label, tone })),
            },
            {
              id: "method",
              name: "Method",
              type: "select",
              options: [
                { id: "cash", label: "Cash", tone: "neutral" },
                { id: "gcash", label: "GCash", tone: "neutral" },
                { id: "maya", label: "Maya", tone: "neutral" },
              ],
            },
            {
              id: "rate",
              name: "Rate per hour",
              type: "formula",
              formula: {
                expr: rateExpr,
                resultType: "money",
                freezeWhen: "status == 'paid' || !is_upcoming(slot)",
              },
            },
            {
              id: "amount",
              name: "Amount",
              type: "formula",
              formula: {
                expr: "rate * duration_hours(slot)",
                resultType: "money",
                freezeWhen: "status == 'paid' || !is_upcoming(slot)",
              },
            },
          ],
        },
      ],
      views: [
        { id: "schedule", entityId: "booking", name: "Schedule", type: "slot_grid" },
        {
          id: "all_bookings",
          entityId: "booking",
          name: "List",
          type: "table",
          fieldIds: ["slot", "resource", "customer", "status", "amount"],
          sort: [{ fieldId: "slot", dir: "asc" }],
        },
        {
          id: "resources_table",
          entityId: "resource",
          name: `All ${units.toLowerCase()}`,
          type: "table",
          fieldIds: ["name", "bookings"],
        },
        {
          id: "customers_table",
          entityId: "customer",
          name: "All customers",
          type: "table",
          fieldIds: ["name", "phone", "visits"],
        },
      ],
      widgets: [
        {
          id: "bookings_today",
          title: "Bookings today",
          entityId: "booking",
          type: "stat",
          filter: "is_today(slot) && status != 'cancelled'",
          metric: { op: "count" },
        },
        {
          id: "revenue_today",
          title: "Collected today",
          entityId: "booking",
          type: "stat",
          filter: "is_today(slot) && status == 'paid'",
          metric: { op: "sum", fieldId: "amount" },
        },
        {
          id: "unpaid_today",
          title: "Unpaid today",
          entityId: "booking",
          type: "stat",
          filter: "is_today(slot) && status == 'unpaid'",
          metric: { op: "sum", fieldId: "amount" },
        },
        {
          id: "unpaid_list",
          title: "Needs payment",
          entityId: "booking",
          type: "list",
          filter: "status == 'unpaid' && is_upcoming(slot)",
          metric: { op: "count" },
          list: {
            fieldIds: ["slot", "resource", "amount"],
            limit: 5,
            viewId: "all_bookings",
            sort: [{ fieldId: "slot", dir: "asc" }],
          },
        },
      ],
      rules: [],
    },
    records: Array.from({ length: count }, (_, i) => ({
      id: `resource_${i + 1}`,
      entityId: "resource",
      data: { name: `${unit} ${i + 1}`, bookings: 0 },
      createdAt: stamp,
      updatedAt: stamp,
    })),
  };
}

/** What the new workspace will contain, in plain words, before it's created. */
export function blueprintPreview(data: WorkspaceData): { label: string; detail: string }[] {
  const bp = data.blueprint;
  return [
    ...bp.entities.map((e) => ({
      label: e.pluralName,
      detail: e.resource
        ? `${data.records.filter((r) => r.entityId === e.id).length} ${e.pluralName.toLowerCase()}, open ${e.resource.opensAt}–${e.resource.closesAt}, ${e.resource.slotMinutes}-minute slots`
        : e.fields
            .filter((f) => f.type !== "rollup" && f.type !== "formula" && f.id !== e.primaryFieldId)
            .map((f) => f.name)
            .slice(0, 5)
            .join(", "),
    })),
    {
      label: "Screens",
      detail: bp.views.map((v) => (v.type === "slot_grid" ? "Schedule" : v.name)).join(", "),
    },
  ];
}
