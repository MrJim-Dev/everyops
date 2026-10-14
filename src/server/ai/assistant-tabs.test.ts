import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps, type ChangeOp } from "@/lib/engine/changes";
import { missingAfterApply, replacedTabs } from "./assistant";

const NOW = new Date("2026-10-13T09:30:00+08:00");
const tabsOf = (bp: ReturnType<typeof courtBookingsSample>["blueprint"]) =>
  bp.systems
    .find((s) => s.id === "bookings")
    ?.viewIds.map((id) => {
      const v = bp.views.find((x) => x.id === id);
      return `${id}:${v?.type}`;
    });
const board = (id: string): ChangeOp => ({
  op: "add_view",
  systemId: "bookings",
  view: {
    id,
    entityId: "booking",
    name: "List",
    type: "kanban",
    statusFieldId: "status",
    cardFieldIds: ["court"],
  },
});

describe("turning a tab into another layout", () => {
  it("keeps the board when it reuses the removed table's id, in the table's place", () => {
    // What Gemini sent for "turn all bookings into kanban": the add ran first and was skipped, then the removal
    // deleted the table, and the plan still said Applied.
    const { blueprint } = courtBookingsSample(NOW);
    const ops: ChangeOp[] = [board("all_bookings"), { op: "remove_view", viewId: "all_bookings" }];
    const errors: string[] = [];
    replacedTabs(blueprint, ops, errors);
    const next = applyOps(blueprint, ops);
    expect(errors).toEqual([]);
    expect(missingAfterApply(ops, next)).toEqual([]);
    expect(tabsOf(next)).toEqual([
      "schedule:slot_grid",
      "all_bookings:kanban",
      "booking_calendar:calendar",
      "new_booking:form",
    ]);
  });

  it("puts a board with a new id where the removed table was", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const ops: ChangeOp[] = [board("bookings_kanban"), { op: "remove_view", viewId: "all_bookings" }];
    replacedTabs(blueprint, ops, []);
    const next = applyOps(blueprint, ops);
    expect(tabsOf(next)).toEqual([
      "schedule:slot_grid",
      "bookings_kanban:kanban",
      "booking_calendar:calendar",
      "new_booking:form",
    ]);
  });

  it("refuses a new tab that reuses an id nothing removes, instead of doing nothing", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const ops: ChangeOp[] = [board("all_bookings")];
    const errors: string[] = [];
    replacedTabs(blueprint, ops, errors);
    expect(errors[0]).toContain('tab "all_bookings" already exists');
    expect(missingAfterApply(ops, applyOps(blueprint, ops))).toEqual([]);
  });

  it("reports an addition the applied plan doesn't contain", () => {
    const { blueprint } = courtBookingsSample(NOW);
    // Without the pairing, the board is skipped and the removal takes the table.
    const ops: ChangeOp[] = [board("all_bookings"), { op: "remove_view", viewId: "all_bookings" }];
    expect(missingAfterApply(ops, applyOps(blueprint, ops))[0]).toContain('tab "all_bookings"');
  });

  it("leaves adding and removing tabs on different pages alone", () => {
    const { blueprint } = courtBookingsSample(NOW);
    const ops: ChangeOp[] = [
      { ...board("court_board"), systemId: "courts" } as ChangeOp,
      { op: "remove_view", viewId: "all_bookings" },
    ];
    replacedTabs(blueprint, ops, []);
    expect(ops.map((o) => o.op)).toEqual(["add_view", "remove_view"]);
  });
});
