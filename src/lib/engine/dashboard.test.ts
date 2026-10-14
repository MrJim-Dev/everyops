import { describe, expect, it } from "vitest";
import { formSteps, missingInStep, stepOfField } from "@/lib/blueprint/form-steps";
import type { Blueprint, DataRecord, FormView, Widget } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { agendaDays, compareStat, heatmapData } from "./dashboard";
import { toCsv } from "./value-text";

// Wed 14 Oct 2026, 10:30 AM in Manila.
const NOW = new Date("2026-10-14T10:30:00+08:00");

const bp: Blueprint = {
  version: 1,
  workspaceName: "Test",
  systems: [{ id: "home", name: "Home", icon: "gauge", viewIds: [], widgetIds: ["w"] }],
  entities: [
    {
      id: "sale",
      name: "Sale",
      pluralName: "Sales",
      primaryFieldId: "name",
      fields: [
        { id: "name", name: "Name", type: "text", required: true },
        { id: "amount", name: "Amount", type: "money" },
        { id: "at", name: "When", type: "datetime" },
        { id: "slot", name: "Slot", type: "time_range" },
        { id: "day", name: "Day", type: "date" },
        {
          id: "status",
          name: "Status",
          type: "status",
          options: [{ id: "open", label: "Open", tone: "neutral" }],
        },
      ],
    },
  ],
  views: [],
  widgets: [],
  rules: [],
};

let n = 0;
const sale = (data: DataRecord["data"]): DataRecord => ({
  id: `s${++n}`,
  entityId: "sale",
  data: { name: `Sale ${n}`, ...data },
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
const at = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`).toISOString();
const widget = (patch: Partial<Widget>): Widget => ({
  id: "w",
  title: "Sales",
  entityId: "sale",
  type: "stat",
  metric: { op: "sum", fieldId: "amount" },
  ...patch,
});

describe("period comparison", () => {
  const records = [
    sale({ amount: 300, at: at("2026-10-14", "09:00") }),
    sale({ amount: 200, at: at("2026-10-14", "18:00") }),
    sale({ amount: 400, at: at("2026-10-13", "12:00") }),
    sale({ amount: 999, at: at("2026-09-01", "12:00") }),
  ];

  it("compares today with yesterday by the Manila calendar day", () => {
    const c = compareStat(bp, widget({ compare: { dateFieldId: "at", period: "day" } }), records, NOW);
    expect(c).toMatchObject({ current: 500, previous: 400, against: "yesterday" });
    expect(c?.change).toBeCloseTo(0.25);
  });

  it("compares the last 7 days with the 7 before, and builds a daily sparkline ending today", () => {
    const c = compareStat(bp, widget({ compare: { dateFieldId: "at", period: "week" } }), records, NOW);
    expect(c).toMatchObject({ current: 900, previous: 0, change: null, against: "the previous 7 days" });
    expect(c?.spark).toHaveLength(14);
    expect(c?.spark.slice(-2)).toEqual([400, 500]);
  });

  it("returns nothing for a stat without compare", () => {
    expect(compareStat(bp, widget({}), records, NOW)).toBeNull();
  });
});

describe("agenda", () => {
  it("lists today's items by time, marks finished ones, and keeps today even when empty", () => {
    const records = [
      sale({ slot: { start: at("2026-10-14", "18:00"), end: at("2026-10-14", "19:00") } }),
      sale({ slot: { start: at("2026-10-14", "08:00"), end: at("2026-10-14", "09:00") } }),
      sale({ slot: { start: at("2026-10-15", "08:00"), end: at("2026-10-15", "09:00") } }),
    ];
    const today = agendaDays(bp, widget({ type: "agenda", agenda: { dateFieldId: "slot" } }), records, NOW);
    expect(today).toHaveLength(1);
    expect(today[0].items.map((i) => [i.start.slice(11, 16), i.past])).toEqual([
      ["00:00", true],
      ["10:00", false],
    ]);
    const empty = agendaDays(bp, widget({ type: "agenda", agenda: { dateFieldId: "slot" } }), [], NOW);
    expect(empty).toEqual([{ day: "2026-10-14", items: [] }]);
    const twoDays = agendaDays(
      bp,
      widget({ type: "agenda", agenda: { dateFieldId: "slot", days: 2 } }),
      records,
      NOW,
    );
    expect(twoDays.map((d) => [d.day, d.items.length])).toEqual([
      ["2026-10-14", 2],
      ["2026-10-15", 1],
    ]);
  });
});

describe("heatmap", () => {
  it("counts every hour a booking covers, Monday first, and splits sums across those hours", () => {
    // Mon 12 Oct, 6 to 8 PM.
    const records = [
      sale({ amount: 800, slot: { start: at("2026-10-12", "18:00"), end: at("2026-10-12", "20:00") } }),
    ];
    const count = heatmapData(
      bp,
      widget({ type: "heatmap", metric: { op: "count" }, heatmap: { dateFieldId: "slot" } }),
      records,
      NOW,
    );
    expect(count.hours).toEqual([18, 19]);
    expect(count.cells[0]).toEqual([1, 1]);
    expect(count.cells[1]).toEqual([0, 0]);
    const sum = heatmapData(bp, widget({ type: "heatmap", heatmap: { dateFieldId: "slot" } }), records, NOW);
    expect(sum.cells[0]).toEqual([400, 400]);
    expect(sum.max).toBe(400);
  });

  it("leaves out records older than the window", () => {
    const records = [sale({ at: at("2026-07-01", "10:00") })];
    const map = heatmapData(
      bp,
      widget({ type: "heatmap", metric: { op: "count" }, heatmap: { dateFieldId: "at", weeks: 4 } }),
      records,
      NOW,
    );
    expect(map.max).toBe(0);
  });
});

describe("multi-step forms", () => {
  const entity = bp.entities[0];
  const view: FormView = {
    id: "f",
    entityId: "sale",
    name: "New sale",
    type: "form",
    fieldIds: ["amount", "at"],
    steps: [{ id: "one", title: "Amount", fieldIds: ["amount"] }],
  };

  it("puts required fields that no step asks on the last step", () => {
    expect(formSteps(entity, view).map((s) => s.fieldIds)).toEqual([["amount", "at", "name"]]);
  });

  it("finds missing required fields in a step and the step that asks a field", () => {
    const steps = formSteps(entity, view);
    expect(missingInStep(entity, steps[0], { amount: 5 })).toEqual(["name"]);
    expect(stepOfField(steps, "name")).toBe(0);
    expect(stepOfField(steps, "nope")).toBe(-1);
  });
});

describe("validation of the new blocks", () => {
  const messages = (patch: Partial<Blueprint>) =>
    validateBlueprint({ ...bp, ...patch }).map((e) => e.message);

  it("needs a date for comparisons and agendas, and a time of day for heatmaps", () => {
    expect(messages({ widgets: [widget({ compare: { dateFieldId: "name", period: "day" } })] })).toContain(
      "Sales: compare needs a date, date-time or time range field",
    );
    expect(messages({ widgets: [widget({ type: "heatmap", heatmap: { dateFieldId: "day" } })] })).toContain(
      "Sales: a heatmap needs a date-time or time range field with times",
    );
    expect(messages({ widgets: [widget({ type: "agenda", agenda: { dateFieldId: "slot" } })] })).toEqual([]);
  });

  it("rejects a field asked in two steps and grouping by a text field", () => {
    const form: FormView = {
      id: "f",
      entityId: "sale",
      name: "New sale",
      type: "form",
      fieldIds: [],
      steps: [
        { id: "a", title: "A", fieldIds: ["name"] },
        { id: "b", title: "B", fieldIds: ["name"] },
      ],
    };
    expect(messages({ views: [form] })).toContain('New sale: "name" is asked in two steps');
    expect(
      messages({
        views: [
          {
            id: "t",
            entityId: "sale",
            name: "All",
            type: "table",
            fieldIds: ["name"],
            groupByFieldId: "name",
          },
        ],
      }),
    ).toContain("All can only group by a select, status, relation, person or checkbox field");
  });

  it("accepts the court bookings template with its layout, agenda, heatmap, steps and grouped table", () => {
    expect(validateBlueprint(courtBookingsSample(NOW).blueprint)).toEqual([]);
  });
});

describe("CSV export", () => {
  it("quotes values with commas and quotes, and formats money like the screen does", () => {
    const records = [sale({ name: 'Ana "AJ" Cruz, Jr.', amount: 1500 })];
    const fields = [bp.entities[0].fields[0], bp.entities[0].fields[1]];
    expect(toCsv(bp, records, fields, records)).toBe('Name,Amount\n"Ana ""AJ"" Cruz, Jr.","₱1,500"');
  });
});
