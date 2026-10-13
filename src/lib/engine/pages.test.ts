import { describe, expect, it } from "vitest";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "./changes";

const NOW = new Date("2026-10-13T09:30:00+08:00");

describe("page changes", () => {
  it("moves the calendar tab onto its own page and keeps the others", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const next = applyOps(blueprint, [
      {
        op: "add_system",
        system: { id: "calendar_page", name: "Calendar", icon: "calendar", viewIds: [], widgetIds: [] },
      },
      { op: "move_view", viewId: "booking_calendar", systemId: "calendar_page" },
    ]);
    expect(next.systems.find((s) => s.id === "calendar_page")?.viewIds).toEqual(["booking_calendar"]);
    expect(next.systems.find((s) => s.id === "bookings")?.viewIds).not.toContain("booking_calendar");
    expect(validateBlueprint(next)).toEqual([]);
  });

  it("removes a page once its last tab moves away", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const next = applyOps(blueprint, [{ op: "move_view", viewId: "courts_table", systemId: "bookings" }]);
    expect(next.systems.some((s) => s.id === "courts")).toBe(false);
    expect(next.systems.find((s) => s.id === "bookings")?.viewIds).toContain("courts_table");
  });

  it("renames pages and tabs", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const next = applyOps(blueprint, [
      { op: "rename_system", systemId: "courts", name: "Court management" },
      { op: "rename_view", viewId: "courts_table", name: "All courts" },
    ]);
    expect(next.systems.find((s) => s.id === "courts")?.name).toBe("Court management");
    expect(next.views.find((v) => v.id === "courts_table")?.name).toBe("All courts");
  });

  it("gives the same result when a plan is applied twice (rehearsed on the server, then applied)", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const system = {
      id: "handbook_page",
      name: "Handbook",
      icon: "house" as const,
      viewIds: [],
      widgetIds: [],
    };
    const plan = [
      { op: "add_system" as const, system },
      {
        op: "add_view" as const,
        systemId: "handbook_page",
        view: { id: "handbook", entityId: "", name: "Handbook", type: "document" as const },
      },
    ];
    applyOps(blueprint, plan);
    const next = applyOps(blueprint, plan);
    expect(next.systems.find((s) => s.id === "handbook_page")?.viewIds).toEqual(["handbook"]);
    expect(system.viewIds).toEqual([]);
  });
});
