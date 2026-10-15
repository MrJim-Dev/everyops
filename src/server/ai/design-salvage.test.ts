import { describe, expect, it } from "vitest";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { salvage } from "./design-salvage";

const sample = () => structuredClone(courtBookingsSample(new Date("2026-10-13T09:30:00+08:00")).blueprint);

describe("salvage", () => {
  it("takes out a broken screen, card and rule, keeps every record type, and says what went", () => {
    const bp = sample();
    const entities = bp.entities.map((e) => e.id);
    bp.views.push({
      id: "broken_board",
      type: "kanban",
      entityId: "booking",
      name: "Broken board",
      statusFieldId: "nope",
      cardFieldIds: [],
    });
    bp.systems[0].viewIds.push("broken_board");
    bp.widgets.push({
      id: "broken_card",
      title: "Broken card",
      entityId: "booking",
      type: "stat",
      metric: { op: "sum", fieldId: "missing_amount" },
    });
    bp.rules.push({
      id: "broken_rule",
      name: "Broken rule",
      trigger: { entityId: "booking", event: "created" },
      when: "missing_field == 1",
      actions: [{ type: "notify", message: "New booking" }],
    });
    const result = salvage(bp);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(validateBlueprint(result.bp)).toEqual([]);
    expect(result.bp.entities.map((e) => e.id)).toEqual(entities);
    expect(result.removed.map((r) => r.request).sort()).toEqual([
      "Broken board",
      "Broken card",
      "Broken rule",
    ]);
    expect(result.bp.systems.flatMap((s) => s.viewIds)).not.toContain("broken_board");
  });

  it("returns a valid workspace untouched", () => {
    const result = salvage(sample());
    expect(result?.removed).toEqual([]);
  });
});
