import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { chartData } from "./aggregate";

const NOW = new Date("2026-10-13T09:30:00+08:00");

describe("charts by category", () => {
  it("totals paid amounts per court, one bar per court", () => {
    const { blueprint, records } = courtBookingsSample(NOW);
    const widget = {
      id: "by_court",
      title: "Revenue by court",
      entityId: "booking",
      type: "chart" as const,
      filter: "status == 'paid'",
      metric: { op: "sum" as const, fieldId: "amount" },
      chart: { kind: "bar" as const, bucket: "day" as const, groupByFieldId: "court" },
    };
    const { points } = chartData(blueprint, widget, records, NOW);
    const paid = records.filter((r) => r.entityId === "booking" && r.data.status === "paid");
    expect(paid.length).toBeGreaterThan(0);
    const expected = paid.reduce((a, r) => a + Number(r.data.amount ?? 0), 0);
    expect(points.map((p) => p.label).every((l) => /^Court \d$/.test(String(l)))).toBe(true);
    expect(points.reduce((a, p) => a + Number(p.value), 0)).toBe(expected);
  });

  it("keeps status options in their own order for a donut", () => {
    const { blueprint, records } = courtBookingsSample(NOW);
    const widget = {
      id: "by_payment",
      title: "Bookings by payment",
      entityId: "booking",
      type: "chart" as const,
      metric: { op: "count" as const },
      chart: { kind: "donut" as const, bucket: "day" as const, groupByFieldId: "status" },
    };
    const { points } = chartData(blueprint, widget, records, NOW);
    expect(points.map((p) => p.label)).toEqual(["Unpaid", "Paid", "Cancelled"]);
    expect(points.reduce((a, p) => a + Number(p.value), 0)).toBe(
      records.filter((r) => r.entityId === "booking").length,
    );
  });
});

describe("page types", () => {
  const withViews = (bp: Blueprint, views: Blueprint["views"]): Blueprint => ({
    ...bp,
    views: [...bp.views, ...views],
    systems: [
      ...bp.systems,
      { id: "extra", name: "Extra", icon: "briefcase", viewIds: views.map((v) => v.id), widgetIds: [] },
    ],
  });

  it("accepts a markdown page with no record type, a booking form and a notebook", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const bp = withViews(blueprint, [
      { id: "handbook", entityId: "", name: "Handbook", type: "document", starter: "# House rules" },
      {
        id: "booking_form",
        entityId: "booking",
        name: "Booking form",
        type: "form",
        fieldIds: ["court", "player"],
      },
    ]);
    expect(validateBlueprint(bp)).toEqual([]);
  });

  it("rejects a notebook whose body isn't long text", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const bp = withViews(blueprint, [
      {
        id: "player_notes",
        entityId: "player",
        name: "Notes",
        type: "notes",
        titleFieldId: "name",
        bodyFieldId: "phone",
      },
    ]);
    expect(validateBlueprint(bp).map((e) => e.message)).toContain(
      "A notebook's body must be a long text field",
    );
  });
});
