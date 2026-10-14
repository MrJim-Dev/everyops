import { describe, expect, it } from "vitest";
import type { Widget } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { widgetValue } from "./aggregate";
import { applyOps } from "./changes";

const NOW = new Date("2026-10-13T09:30:00+08:00");
const { blueprint, records } = courtBookingsSample(NOW);
const amountOf = (status: string) =>
  records
    .filter((r) => r.entityId === "booking" && r.data.status === status)
    .reduce((a, r) => a + Number(r.data.amount ?? 0), 0);
const courts = records.filter((r) => r.entityId === "court").length;

const card = (calc: Widget["calc"], type: Widget["type"] = "stat"): Widget => ({
  id: "combined",
  title: "Combined",
  entityId: "booking",
  type,
  metric: { op: "count" },
  calc,
});

describe("summary cards with a formula", () => {
  it("adds totals from different filters and record types", () => {
    const widget = card({
      expr: "paid + unpaid + courts",
      terms: [
        { id: "paid", entityId: "booking", op: "sum", fieldId: "amount", filter: "status == 'paid'" },
        { id: "unpaid", entityId: "booking", op: "sum", fieldId: "amount", filter: "status == 'unpaid'" },
        { id: "courts", entityId: "court", op: "count" },
      ],
    });
    expect(amountOf("paid")).toBeGreaterThan(0);
    expect(widgetValue(blueprint, widget, records, NOW)).toBe(amountOf("paid") + amountOf("unpaid") + courts);
    expect(validateBlueprint({ ...blueprint, widgets: [...blueprint.widgets, widget] })).toEqual([]);
  });

  it("works out rates, and shows 0 instead of dividing by zero", () => {
    const rate = card({
      expr: "paid / booked * 100",
      format: "percent",
      terms: [
        { id: "paid", entityId: "booking", op: "count", filter: "status == 'paid'" },
        { id: "booked", entityId: "booking", op: "count" },
      ],
    });
    const all = records.filter((r) => r.entityId === "booking");
    const paid = all.filter((r) => r.data.status === "paid").length;
    expect(widgetValue(blueprint, rate, records, NOW)).toBeCloseTo((paid / all.length) * 100);
    const none = card({
      expr: "a / b",
      terms: [
        { id: "a", entityId: "court", op: "count" },
        { id: "b", entityId: "court", op: "count", filter: "false" },
      ],
    });
    expect(widgetValue(blueprint, none, records, NOW)).toBe(0);
  });

  it("explains formulas that name unknown totals, fields or record types", () => {
    const broken = card({
      expr: "bookings + income",
      terms: [
        { id: "bookings", entityId: "booking", op: "sum", fieldId: "nope" },
        { id: "extra", entityId: "ghost", op: "count" },
      ],
    });
    const messages = validateBlueprint({ ...blueprint, widgets: [...blueprint.widgets, broken] }).map(
      (e) => e.message,
    );
    expect(messages.some((m) => m.includes('"nope"'))).toBe(true);
    expect(messages.some((m) => m.includes('missing entity "ghost"'))).toBe(true);
    expect(messages.some((m) => m.includes('"income" in the formula'))).toBe(true);
  });

  it("turns an existing card into a formula with update_widget, leaving the old version as it was", () => {
    const target = blueprint.widgets.find((w) => w.type === "stat");
    if (!target) throw new Error("sample has no stat");
    const calc = {
      expr: "players + courts",
      terms: [
        { id: "players", entityId: "player", op: "count" as const },
        { id: "courts", entityId: "court", op: "count" as const },
      ],
    };
    const next = applyOps(blueprint, [
      { op: "update_widget", widgetId: target.id, patch: { title: "People and courts", calc } },
    ]);
    const updated = next.widgets.find((w) => w.id === target.id);
    expect(updated).toMatchObject({ title: "People and courts", entityId: "player", calc });
    expect(blueprint.widgets.find((w) => w.id === target.id)?.calc).toBeUndefined();
    const players = records.filter((r) => r.entityId === "player").length;
    expect(updated && widgetValue(next, updated, records, NOW)).toBe(players + courts);
    expect(validateBlueprint(next)).toEqual([]);
  });
});
