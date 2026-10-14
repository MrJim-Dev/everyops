import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "@/lib/engine/compute";
import { addDays, at, hhmm, todayKey } from "@/lib/time";
import { f, recordFactory, seeded } from "./define";

export function courtBookingsBlueprint(workspaceName = "Court bookings"): Blueprint {
  return {
    version: 1,
    workspaceName,
    systems: [
      {
        id: "overview",
        name: "Overview",
        icon: "gauge",
        viewIds: [],
        widgetIds: [
          "bookings_today",
          "revenue_today",
          "unpaid_today",
          "revenue_month",
          "today_schedule",
          "unpaid_list",
          "busy_hours",
        ],
        layout: "overview",
      },
      {
        id: "bookings",
        name: "Bookings",
        icon: "calendar",
        viewIds: ["schedule", "all_bookings", "booking_calendar", "new_booking"],
        widgetIds: [],
      },
      { id: "courts", name: "Courts", icon: "court", viewIds: ["courts_table"], widgetIds: [] },
      { id: "players", name: "Players", icon: "users", viewIds: ["players_table"], widgetIds: [] },
    ],
    entities: [
      {
        id: "court",
        name: "Court",
        pluralName: "Courts",
        primaryFieldId: "name",
        resource: { opensAt: "06:00", closesAt: "23:00", slotMinutes: 60 },
        fields: [
          f.text("name", "Name", { required: true }),
          f.select("surface", "Surface", [
            ["indoor", "Indoor"],
            ["outdoor", "Outdoor"],
          ]),
          f.rollup("bookings", "Bookings", { childEntityId: "booking", viaFieldId: "court", op: "count" }),
        ],
      },
      {
        id: "player",
        name: "Player",
        pluralName: "Players",
        primaryFieldId: "name",
        fields: [
          f.text("name", "Name", { required: true }),
          f.text("phone", "Phone"),
          f.rollup("visits", "Bookings", { childEntityId: "booking", viaFieldId: "player", op: "count" }),
          f.rollup("spent", "Total spent", {
            childEntityId: "booking",
            viaFieldId: "player",
            op: "sum",
            fieldId: "amount",
          }),
        ],
      },
      {
        id: "booking",
        name: "Booking",
        pluralName: "Bookings",
        primaryFieldId: "player_name",
        booking: {
          resourceFieldId: "court",
          timeFieldId: "slot",
          statusFieldId: "status",
          blockingStatuses: ["unpaid", "paid"],
        },
        fields: [
          f.formula("player_name", "Booking", "player.name", "text"),
          f.relation("player", "Player", "player", { required: true }),
          f.relation("court", "Court", "court", { required: true }),
          f.timeRange("slot", "Time", { required: true }),
          f.status(
            "status",
            "Payment",
            [
              ["unpaid", "Unpaid", "warning"],
              ["paid", "Paid", "success"],
              ["cancelled", "Cancelled", "neutral"],
            ],
            { required: true },
          ),
          f.select("method", "Method", [
            ["cash", "Cash"],
            ["gcash", "GCash"],
            ["maya", "Maya"],
          ]),
          f.select("source", "Booked via", [
            ["walk_in", "Walk-in"],
            ["messenger", "Messenger"],
            ["phone", "Phone"],
          ]),
          f.formula("rate", "Rate per hour", "400", "money", "status == 'paid' || !is_upcoming(slot)"),
          f.formula(
            "amount",
            "Amount",
            "rate * duration_hours(slot)",
            "money",
            "status == 'paid' || !is_upcoming(slot)",
          ),
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
        fieldIds: ["slot", "court", "player", "status", "method", "amount"],
        sort: [{ fieldId: "slot", dir: "asc" }],
        filter: "is_upcoming(slot)",
        groupByFieldId: "status",
        totals: true,
      },
      {
        id: "booking_calendar",
        entityId: "booking",
        name: "Calendar",
        type: "calendar",
        dateFieldId: "slot",
        titleFieldId: "player_name",
      },
      {
        id: "new_booking",
        entityId: "booking",
        name: "New booking",
        type: "form",
        fieldIds: ["court", "slot", "player", "status", "method", "source"],
        intro: "Book a court for a player at the front desk.",
        submitLabel: "Book court",
        steps: [
          { id: "when", title: "Court and time", fieldIds: ["court", "slot"] },
          { id: "who", title: "Player", fieldIds: ["player"] },
          { id: "pay", title: "Payment", fieldIds: ["status", "method", "source"] },
        ],
        review: true,
      },
      {
        id: "courts_table",
        entityId: "court",
        name: "All courts",
        type: "table",
        fieldIds: ["name", "surface", "bookings"],
      },
      {
        id: "players_table",
        entityId: "player",
        name: "All players",
        type: "table",
        fieldIds: ["name", "phone", "visits", "spent"],
        sort: [{ fieldId: "spent", dir: "desc" }],
      },
    ],
    widgets: [
      {
        id: "bookings_today",
        title: "Bookings today",
        entityId: "booking",
        type: "stat",
        filter: "status != 'cancelled'",
        metric: { op: "count" },
        compare: { dateFieldId: "slot", period: "day" },
        sparkline: true,
      },
      {
        id: "revenue_today",
        title: "Collected today",
        entityId: "booking",
        type: "stat",
        filter: "status == 'paid'",
        metric: { op: "sum", fieldId: "amount" },
        compare: { dateFieldId: "slot", period: "day" },
        sparkline: true,
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
        id: "revenue_month",
        title: "Revenue this month",
        entityId: "booking",
        type: "chart",
        filter: "status == 'paid'",
        metric: { op: "sum", fieldId: "amount" },
        chart: { kind: "bar", dateFieldId: "slot", bucket: "day" },
      },
      {
        id: "today_schedule",
        title: "Today's schedule",
        entityId: "booking",
        type: "agenda",
        filter: "status != 'cancelled'",
        metric: { op: "count" },
        agenda: { dateFieldId: "slot", fieldIds: ["court", "status"] },
      },
      {
        id: "busy_hours",
        title: "Busy hours",
        entityId: "booking",
        type: "heatmap",
        filter: "status != 'cancelled'",
        metric: { op: "count" },
        heatmap: { dateFieldId: "slot", weeks: 6 },
        width: "two_thirds",
      },
      {
        id: "unpaid_list",
        title: "Needs payment",
        entityId: "booking",
        type: "list",
        filter: "status == 'unpaid' && is_upcoming(slot)",
        metric: { op: "count" },
        list: {
          fieldIds: ["slot", "court", "amount"],
          limit: 5,
          viewId: "all_bookings",
          sort: [{ fieldId: "slot", dir: "asc" }],
        },
      },
    ],
    rules: [],
  };
}

const PLAYERS = [
  ["Rhea Abellana", "0917 482 1190"],
  ["Miguel Santos", "0918 223 4471"],
  ["Alyssa Tan", "0927 310 8854"],
  ["Carlo Mendoza", "0905 667 1203"],
  ["Daniel Go", "0917 908 3316"],
  ["Bianca Reyes", "0920 145 7782"],
  ["Kevin Sy", "0995 238 6610"],
  ["Marco Lim", "0917 554 0921"],
  ["Tina Salazar", "0918 771 2034"],
  ["Noel Dela Cruz", "0939 402 6618"],
  ["Patrick Uy", "0917 330 4512"],
  ["Isabel Co", "0926 881 0473"],
] as const;

export function courtBookingsSample(now: Date, workspaceName?: string): WorkspaceData {
  const blueprint = courtBookingsBlueprint(workspaceName);
  const rec = recordFactory(now);
  const rng = seeded(4127);
  const records: DataRecord[] = [];
  const courts = ["Court 1", "Court 2", "Court 3", "Court 4"].map((name, i) =>
    rec("court", `court_${i + 1}`, { name, surface: i < 2 ? "indoor" : "outdoor" }),
  );
  const players = PLAYERS.map(([name, phone], i) => rec("player", `player_${i + 1}`, { name, phone }));
  records.push(...courts, ...players);

  const today = todayKey(now);
  let n = 0;
  const book = (day: string, court: number, startHour: number, player: number, status: string) => {
    n++;
    records.push(
      rec("booking", `booking_${n}`, {
        player: players[player].id,
        court: courts[court].id,
        slot: { start: at(day, hhmm(startHour * 60)), end: at(day, hhmm((startHour + 1) * 60)) },
        status,
        method: status === "paid" ? rng.pick(["cash", "gcash", "gcash", "maya"]) : null,
        source: rng.pick(["walk_in", "messenger", "messenger", "phone"]),
      }),
    );
  };

  // Today: a realistic, readable day with two unpaid bookings.
  const todayPlan: [number, number, number, string][] = [
    [0, 10, 1, "paid"],
    [2, 11, 2, "paid"],
    [1, 12, 3, "paid"],
    [3, 13, 4, "paid"],
    [0, 14, 5, "paid"],
    [2, 15, 6, "paid"],
    [1, 16, 7, "paid"],
    [3, 17, 8, "paid"],
    [0, 18, 9, "unpaid"],
    [1, 18, 0, "unpaid"],
    [2, 19, 10, "paid"],
    [3, 19, 11, "paid"],
  ];
  for (const [court, hour, player, status] of todayPlan) book(today, court, hour, player, status);

  // Earlier this month: paid history that feeds revenue charts.
  for (let back = 1; back <= Number(today.slice(8)) - 1; back++) {
    const day = addDays(today, -back);
    const count = rng.int(6, 14);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const court = rng.int(0, 3);
      const hour = rng.int(6, 21);
      if (used.has(`${court}-${hour}`)) continue;
      used.add(`${court}-${hour}`);
      book(day, court, hour, rng.int(0, players.length - 1), rng.chance(0.06) ? "cancelled" : "paid");
    }
  }

  // Upcoming week: a mix of paid and unpaid bookings.
  for (let ahead = 1; ahead <= 6; ahead++) {
    const day = addDays(today, ahead);
    const used = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const court = rng.int(0, 3);
      const hour = rng.pick([7, 9, 16, 17, 18, 19, 20]);
      if (used.has(`${court}-${hour}`)) continue;
      used.add(`${court}-${hour}`);
      book(day, court, hour, rng.int(0, players.length - 1), rng.chance(0.35) ? "paid" : "unpaid");
    }
  }

  return { blueprint, records: computeAll(blueprint, records, now) };
}
