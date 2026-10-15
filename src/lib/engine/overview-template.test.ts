import { describe, expect, it } from "vitest";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { templateOverview } from "./overview-template";

const NOW = new Date("2026-10-13T09:30:00+08:00");

describe("templateOverview", () => {
  it("lays out the Overview like the court-bookings template, from the workspace's own fields", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const board = blueprint.systems[0];
    // A designer Overview with plain stats and an extra chart by court.
    blueprint.widgets = [
      {
        id: "plain_total",
        title: "Total bookings",
        entityId: "booking",
        type: "stat",
        metric: { op: "count" },
      },
      {
        id: "by_court",
        title: "Bookings by court",
        entityId: "booking",
        type: "chart",
        metric: { op: "count" },
        chart: { kind: "bar", bucket: "day", groupByFieldId: "court" },
      },
    ];
    board.widgetIds = ["plain_total", "by_court"];
    delete board.layout;

    templateOverview(blueprint);

    const shown = board.widgetIds.map((id) => blueprint.widgets.find((w) => w.id === id));
    expect(shown.map((w) => w?.type)).toEqual([
      "stat",
      "stat",
      "stat",
      "chart",
      "agenda",
      "list",
      "heatmap",
      "chart",
    ]);
    expect(shown.map((w) => w?.title)).toEqual([
      "Bookings today",
      "Collected today",
      "Unpaid today",
      "Revenue this month",
      "Today's schedule",
      "Needs payment",
      "Busy hours",
      "Bookings by court",
    ]);
    expect(shown[0]?.compare).toEqual({ dateFieldId: "slot", period: "day" });
    expect(shown[1]?.sparkline).toBe(true);
    expect(shown[1]?.filter).toBe("status == 'paid'");
    expect(board.layout).toBe("overview");
    // The plain stat it replaced is gone, and the result is a valid blueprint.
    expect(blueprint.widgets.some((w) => w.id === "plain_total")).toBe(false);
    expect(validateBlueprint(blueprint)).toEqual([]);
  });

  it("leaves a workspace without dated records alone", () => {
    const { blueprint } = courtBookingsSample(NOW);
    blueprint.entities = blueprint.entities.filter((e) => !e.booking);
    const before = JSON.stringify(blueprint.systems);
    templateOverview(blueprint);
    expect(JSON.stringify(blueprint.systems)).toBe(before);
  });
});
