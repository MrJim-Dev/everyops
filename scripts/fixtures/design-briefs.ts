import type { Entity, Field, WorkspaceData } from "@/lib/blueprint/types";
import type { Scenario } from "@/lib/eval/design-score";

/**
 * Briefs for the setup design eval (scripts/design-eval.mts): three on the template route, two on the playbook route
 * and one custom (playbooks match most businesses, so few briefs reach it), each with checks for what its owner asked
 * for in so many words. Template briefs start the way the interview writes them ("Start from: <system>").
 * Checks look at structure and sample records, and accept any reasonable naming: they test that a request was met,
 * not how Gemini phrased it.
 */

type D = WorkspaceData;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Names are matched in lower case, so patterns are written in lower case. */
const named = (re: RegExp, ...names: string[]) => names.some((n) => re.test(n.toLowerCase()));
const entity = (d: D, re: RegExp, not?: RegExp) =>
  d.blueprint.entities.find(
    (e) => named(re, e.name, e.pluralName) && !(not && named(not, e.name, e.pluralName)),
  );
const booked = (d: D) => d.blueprint.entities.find((e) => e.booking);
/** What is sold or added on: products, menu items, add-ons (never their categories, lines or movements). */
const sold = (d: D) =>
  entity(d, /menu|product|item|add.?on|extra/, /categor|type|line|sale|order|movement|booking|stay/);
const field = (e: Entity | undefined, re: RegExp, types?: Field["type"][]) =>
  e?.fields.find((f) => named(re, f.name) && (!types || types.includes(f.type)));
const statusOf = (e: Entity | undefined) =>
  e?.fields.find((f) => f.id === e.booking?.statusFieldId) ?? e?.fields.find((f) => f.type === "status");
/** Every wanted label is among the field's choices (ignoring case, spaces and dashes). */
const hasChoices = (f: Field | undefined, wanted: string[]) =>
  wanted.every((w) => (f?.options ?? []).some((o) => squash(o.label).includes(squash(w))));
const recordsOf = (d: D, e: Entity | undefined) => d.records.filter((r) => r.entityId === e?.id);
const titles = (d: D, e: Entity | undefined) =>
  recordsOf(d, e).map((r) => squash(String(r.data[e?.primaryFieldId ?? ""] ?? "")));
const hasTitles = (d: D, e: Entity | undefined, wanted: string[]) =>
  wanted.every((w) => titles(d, e).some((t) => t.includes(squash(w))));
/** The design and its records as one lowercase text, for facts that may live in either (prices, rates). */
const text = (d: D) => JSON.stringify(d).toLowerCase();
const views = (d: D, e: Entity | undefined, type: string) =>
  d.blueprint.views.filter((v) => v.entityId === e?.id && v.type === type);
const publicForm = (d: D, e: Entity | undefined) =>
  views(d, e, "form").some((v) => "public" in v && v.public === true);
const widget = (d: D, re: RegExp) => d.blueprint.widgets.some((w) => named(re, w.title));
/** Choices or records name every payment method asked for. */
const payments = (d: D, wanted: string[]) => {
  const pay = entity(d, /payment/);
  return pay
    ? hasTitles(d, pay, wanted)
    : d.blueprint.entities.some((e) => hasChoices(field(e, /payment/, ["select", "status"]), wanted));
};

export const SCENARIOS: Scenario[] = [
  {
    id: "courts",
    name: "Smash Pickleball Cebu",
    route: "template",
    brief: `Start from: court-bookings
Smash Pickleball Cebu: 4 indoor pickleball courts in Mandaue, open 6:00 AM to 11:00 PM every day, 60-minute slots.
Rates: ₱400 per hour before 5 PM on weekdays, ₱500 per hour from 5 PM and all day on weekends. Add-ons: paddle rental
₱100 each, pickleball balls ₱150 per can (for sale), towels ₱50. Customers book on a public booking page and pay by
GCash (QR code) or cash at the counter; a booking stays pending until staff confirm the payment reference. Statuses:
pending payment, confirmed, checked in, completed, cancelled, no-show. Remove the "Booked via" field. Add a Players
page with visits and total spent.`,
    asks: [
      {
        id: "four-courts",
        label: "4 courts",
        check: (d) => recordsOf(d, entity(d, /^courts?$/i)).length === 4,
      },
      {
        id: "hours",
        label: "6 AM to 11 PM, 60-minute slots",
        check: (d) =>
          d.blueprint.entities.some(
            (e) =>
              e.resource?.opensAt === "06:00" &&
              e.resource.closesAt === "23:00" &&
              e.resource.slotMinutes === 60,
          ),
      },
      {
        id: "rates",
        label: "₱400 and ₱500 rates",
        check: (d) => /\b400\b/.test(text(d)) && /\b500\b/.test(text(d)),
      },
      {
        id: "add-ons",
        label: "Paddle, balls and towel add-ons",
        check: (d) => hasTitles(d, sold(d), ["paddle", "ball", "towel"]),
      },
      { id: "public-form", label: "Public booking page", check: (d) => publicForm(d, booked(d)) },
      { id: "payments", label: "GCash and cash", check: (d) => payments(d, ["gcash", "cash"]) },
      {
        id: "statuses",
        label: "Six booking statuses",
        check: (d) =>
          hasChoices(statusOf(booked(d)), [
            "pending",
            "confirmed",
            "checked in",
            "completed",
            "cancel",
            "no show",
          ]),
      },
      { id: "no-booked-via", label: "No Booked via field", check: (d) => !field(booked(d), /booked via/i) },
      {
        id: "players",
        label: "Players with visits and total spent",
        check: (d) => {
          const p = entity(d, /player/);
          return !!field(p, /visit/i) && !!field(p, /spent/i);
        },
      },
    ],
  },
  {
    id: "stays",
    name: "Bluewater Cove",
    route: "template",
    brief: `Start from: rental-operations
Bluewater Cove, a beach resort in Moalboal with 6 cottages: 2 family cottages at ₱4,500 a night and 4 couple cottages at
₱2,800 a night. Check-in 2 PM, check-out 12 noon. Guests book on a public page, pick check-in and check-out dates, and
pay a 50% deposit by GCash or bank transfer; the balance is paid on arrival. Statuses: inquiry, reserved (deposit
paid), checked in, checked out, cancelled. Extras: extra bed ₱500 a night, breakfast ₱250 per person, island hopping
₱1,500 per group. Overview: occupancy this month, arrivals today, deposits still unpaid.`,
    asks: [
      {
        id: "six-cottages",
        label: "6 cottages",
        check: (d) =>
          recordsOf(
            d,
            d.blueprint.entities.find((e) => e.resource),
          ).length === 6,
      },
      {
        id: "rates",
        label: "₱4,500 and ₱2,800 rates",
        check: (d) => /\b4500\b/.test(text(d)) && /\b2800\b/.test(text(d)),
      },
      {
        id: "whole-days",
        label: "Bookings by check-in and check-out date",
        check: (d) => {
          const b = booked(d);
          return b?.fields.find((f) => f.id === b.booking?.timeFieldId)?.range === "dates";
        },
      },
      { id: "public-form", label: "Public booking page", check: (d) => publicForm(d, booked(d)) },
      { id: "deposit", label: "50% deposit", check: (d) => !!field(booked(d), /deposit|down ?payment/i) },
      { id: "payments", label: "GCash and bank transfer", check: (d) => payments(d, ["gcash", "bank"]) },
      {
        id: "statuses",
        label: "Five booking statuses",
        check: (d) =>
          hasChoices(statusOf(booked(d)), ["inquiry", "reserved", "checked in", "checked out", "cancel"]),
      },
      {
        id: "extras",
        label: "Extra bed, breakfast, island hopping",
        check: (d) => hasTitles(d, sold(d), ["bed", "breakfast", "island"]),
      },
      {
        id: "arrivals",
        label: "Arrivals today on the Overview",
        check: (d) => widget(d, /arriv|check.?in/i),
      },
    ],
  },
  {
    id: "canteen",
    name: "Kusina ni Nena",
    route: "template",
    brief: `Start from: canteen-pos
Kusina ni Nena, a school canteen in Lapu-Lapu. Menu: rice meals (pork adobo ₱75, sinigang ₱85, fried chicken ₱80),
snacks (turon ₱20, banana cue ₱25), drinks (iced tea ₱25, bottled water ₱20, softdrinks ₱30). The cashier rings up
sales at the counter, several items per sale, paid in cash or GCash. Track the stock of drinks and take it down when
they're sold. Overview: sales today, sales this week by day, best sellers.`,
    asks: [
      {
        id: "menu",
        label: "The 8 menu items",
        check: (d) =>
          hasTitles(d, sold(d), [
            "adobo",
            "sinigang",
            "chicken",
            "turon",
            "banana",
            "iced tea",
            "water",
            "softdrink",
          ]),
      },
      {
        id: "categories",
        label: "Rice meals, snacks, drinks",
        check: (d) => ["rice meal", "snack", "drink"].every((w) => text(d).includes(w)),
      },
      {
        id: "line-items",
        label: "Several items per sale",
        check: (d) =>
          d.blueprint.entities.some((e) => {
            const parent = d.blueprint.entities.find((p) => p.id === e.parent?.entityId);
            return !!parent && /sale|order|transaction/i.test(parent.name);
          }),
      },
      {
        id: "checkout",
        label: "Counter checkout",
        check: (d) => d.blueprint.views.some((v) => v.type === "checkout"),
      },
      { id: "payments", label: "Cash and GCash", check: (d) => payments(d, ["cash", "gcash"]) },
      {
        id: "stock",
        label: "Stock that goes down when sold",
        check: (d) => {
          const product = sold(d);
          const stock = field(product, /stock|on hand|inventory|qty|quantity/i, ["number"]);
          return !!stock && d.blueprint.rules.some((r) => JSON.stringify(r).includes(`"${stock.id}"`));
        },
      },
      { id: "best-sellers", label: "Best sellers on the Overview", check: (d) => widget(d, /best|top/i) },
    ],
  },
  {
    id: "salon",
    name: "Luxe Hair Studio",
    route: "playbook",
    brief: `Luxe Hair Studio, a hair salon in Cebu City with 5 stylists. Services with prices: haircut ₱350, hair color ₱1,800, rebond ₱3,500, treatment ₱900, blowdry ₱300. Appointments booked by phone and Messenger: client, stylist, service, time, status (requested → confirmed → in service → done; cancelled, no-show), payment (cash, GCash). Stylists earn a 40% commission on services they do, paid semi-monthly with payroll runs that list each stylist's services, commission and deductions (SSS, PhilHealth, Pag-IBIG as editable rates). Track daily attendance (time in, time out). Overview: appointments today, revenue this week and month, top services, stylist commissions this period.`,
    asks: [
      {
        id: "services",
        label: "Services with prices",
        check: (d) => {
          const s = entity(d, /service/, /categor|line|appointment|booking/);
          return (
            !!field(s, /./, ["money"]) && hasTitles(d, s, ["haircut", "color", "rebond", "treatment", "blow"])
          );
        },
      },
      {
        id: "appointment-links",
        label: "Appointments link client, stylist and service",
        check: (d) => {
          const a = entity(d, /appointment|booking/);
          const targets = (a?.fields ?? [])
            .filter((f) => f.relation)
            .map((f) => d.blueprint.entities.find((e) => e.id === f.relation?.entityId)?.name ?? "");
          return (
            targets.some((n) => /stylist|staff|employee/i.test(n)) &&
            targets.some((n) => /service/i.test(n)) &&
            (targets.some((n) => /client|customer/i.test(n)) || !!field(a, /client|customer/i))
          );
        },
      },
      {
        id: "statuses",
        label: "Six appointment statuses",
        check: (d) =>
          hasChoices(statusOf(entity(d, /appointment|booking/)), [
            "requested",
            "confirmed",
            "in service",
            "done",
            "cancel",
            "no show",
          ]),
      },
      { id: "payments", label: "Cash and GCash", check: (d) => payments(d, ["cash", "gcash"]) },
      {
        id: "commission",
        label: "Stylist commission",
        check: (d) => d.blueprint.entities.some((e) => !!field(e, /commission/i)),
      },
      { id: "payroll", label: "Payroll runs", check: (d) => !!entity(d, /payroll|pay run|payslip/) },
      {
        id: "deductions",
        label: "SSS, PhilHealth and Pag-IBIG",
        check: (d) => ["sss", "philhealth", "pagibig"].every((w) => squash(text(d)).includes(w)),
      },
      {
        id: "attendance",
        label: "Attendance with time in and out",
        check: (d) => {
          const a = entity(d, /attendance|time ?log|dtr/);
          return (
            (!!field(a, /in\b/i) && !!field(a, /out\b/i)) || !!a?.fields.some((f) => f.type === "time_range")
          );
        },
      },
    ],
  },
  {
    id: "fixwell",
    name: "Fixwell",
    route: "playbook",
    brief:
      "Build a small repair shop called Fixwell. Track customers with name and phone, repair jobs linked to customers with item description and quoted price, and job statuses Received, In progress, Ready, Collected and Cancelled. Give staff a jobs table and status board, a customers table, and an overview showing jobs awaiting collection. Keep all pages private. No online booking or checkout.",
    asks: [
      {
        id: "customers",
        label: "Customers with name and phone",
        check: (d) => {
          const c = entity(d, /customer/);
          return (
            /name/i.test(c?.fields.find((f) => f.id === c.primaryFieldId)?.name ?? "") && !!field(c, /phone/i)
          );
        },
      },
      {
        id: "jobs",
        label: "Jobs link a customer, item and quoted price",
        check: (d) => {
          const j = entity(d, /job|repair/, /customer|categor/);
          const c = entity(d, /customer/);
          return (
            !!j?.fields.some((f) => f.relation?.entityId === c?.id) &&
            !!field(j, /item|description/i) &&
            !!field(j, /quot|price/i, ["money"])
          );
        },
      },
      {
        id: "statuses",
        label: "Five job statuses",
        check: (d) =>
          hasChoices(statusOf(entity(d, /job|repair/, /customer|categor/)), [
            "received",
            "in progress",
            "ready",
            "collected",
            "cancel",
          ]),
      },
      {
        id: "tables",
        label: "Jobs and customers tables",
        check: (d) =>
          views(d, entity(d, /job|repair/, /customer|categor/), "table").length > 0 &&
          views(d, entity(d, /customer/), "table").length > 0,
      },
      {
        id: "board",
        label: "Jobs status board",
        check: (d) => views(d, entity(d, /job|repair/, /customer|categor/), "kanban").length > 0,
      },
      {
        id: "awaiting-collection",
        label: "Jobs awaiting collection on the Overview",
        check: (d) => {
          const j = entity(d, /job|repair/, /customer|categor/);
          const ready = statusOf(j)?.options?.find((o) => /ready/i.test(o.label));
          return (
            !!ready &&
            d.blueprint.widgets.some((w) => w.entityId === j?.id && (w.filter ?? "").includes(ready.id))
          );
        },
      },
      {
        id: "private",
        label: "Every page private",
        check: (d) => !d.blueprint.views.some((v) => "public" in v && v.public),
      },
      {
        id: "no-booking",
        label: "No booking or checkout",
        check: (d) =>
          !d.blueprint.entities.some((e) => e.booking) &&
          !d.blueprint.views.some((v) => v.type === "checkout" || v.type === "slot_grid"),
      },
    ],
  },
  {
    id: "habits",
    name: "Daily Momentum",
    route: "custom",
    brief: `A personal activity and habit tracker called Daily Momentum. Activity Log: Title, Category (relation to Activity Category: Workout, Run, Reading, Meditation, Study), Date, Start Time, Duration Minutes, Duration Hours (formula), Distance Km, Pages Read, Sleep Quality (select: 1 - Poor, 2 - Fair, 3 - Good, 4 - Great, 5 - Optimal), Mood Rating (select 1 to 5), Energy Level (select: 1 - Drained, 2 - Low, 3 - Moderate, 4 - High, 5 - Peak), Notes & Reflection, Status (Planned → Logged; Skipped). Daily Summary: Date (primary), total active minutes (rollup), logs count (rollup), mood, energy level. Rule: when an Activity Log is saved as Logged, link it to the Daily Summary for that date. Overview: Active Days Streak This Month, Total Hours Active This Month, Workouts & Runs Completed, Total Pages Read This Month, Active Minutes by Day of Week & Hour heatmap, Category Breakdown chart, Recent Activity Logs list. Pages: Activity Log (table, board by status, calendar), Daily Summaries (table), Categories (table). Sample records for each.`,
    asks: [
      {
        id: "category-link",
        label: "Activity logs link a category",
        check: (d) => {
          const log = entity(d, /activit/, /categor|summar/);
          const cat = entity(d, /categor/);
          return !!log?.fields.some((f) => f.relation?.entityId === cat?.id);
        },
      },
      {
        id: "sleep",
        label: "Sleep quality as a 5-step choice",
        check: (d) => {
          const f = field(entity(d, /activit/, /categor|summar/), /sleep/i, ["select"]);
          return f?.options?.length === 5 && hasChoices(f, ["poor", "optimal"]);
        },
      },
      {
        id: "energy",
        label: "Energy level as a 5-step choice",
        check: (d) => {
          const f = field(entity(d, /activit/, /categor|summar/), /energy/i, ["select"]);
          return f?.options?.length === 5 && hasChoices(f, ["drained", "peak"]);
        },
      },
      {
        id: "statuses",
        label: "Planned, Logged, Skipped",
        check: (d) =>
          hasChoices(statusOf(entity(d, /activit/, /categor|summar/)), ["planned", "logged", "skipped"]),
      },
      {
        id: "summary-rollups",
        label: "Daily summary with rollups",
        check: (d) => !!entity(d, /summar/)?.fields.some((f) => f.type === "rollup"),
      },
      {
        id: "rule",
        label: "Rule on saving a log",
        check: (d) => {
          const log = entity(d, /activit/, /categor|summar/);
          return d.blueprint.rules.some((r) => r.trigger.entityId === log?.id);
        },
      },
      {
        id: "log-views",
        label: "Log table, board and calendar",
        check: (d) => {
          const log = entity(d, /activit/, /categor|summar/);
          return ["table", "kanban", "calendar"].every((t) => views(d, log, t).length > 0);
        },
      },
      {
        id: "heatmap",
        label: "Heatmap on the Overview",
        check: (d) => d.blueprint.widgets.some((w) => w.type === "heatmap"),
      },
      {
        id: "category-chart",
        label: "Category breakdown chart",
        check: (d) => d.blueprint.widgets.some((w) => w.type === "chart" && !!w.chart?.groupByFieldId),
      },
    ],
  },
];
