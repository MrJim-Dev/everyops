import { describe, expect, it } from "vitest";
import { posSample } from "@/lib/catalog/canteen-pos";
import { renumberTaken, sequenceFields } from "./sequence";

const now = new Date("2026-10-14T03:00:00Z");

describe("sequence numbers taken at the same moment", () => {
  const { blueprint } = posSample(now, "Canteen");
  const orderType = blueprint.entities.find((e) =>
    blueprint.views.some(
      (v) =>
        v.type === "checkout" &&
        blueprint.entities.find((l) => l.id === v.lineEntityId)?.parent?.entityId === e.id,
    ),
  );
  if (!orderType) throw new Error("fixture changed");
  const code = orderType.primaryFieldId;
  const order = (id: string, value: string) => ({
    id,
    entityId: orderType.id,
    data: { [code]: value },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  it("treats the register's order code as a sequence", () => {
    expect(sequenceFields(blueprint, orderType).map((f) => f.id)).toContain(code);
  });

  it("gives a second register's #1251 the next free number, and leaves free numbers alone", () => {
    const stored = [order("a", "#1250"), order("b", "#1251")];
    const out = renumberTaken(blueprint, stored, [order("c", "#1251"), order("d", "#1253")]);
    expect(out.records.map((r) => r.data[code])).toEqual(["#1252", "#1253"]);
    expect(out.changed.map((r) => r.id)).toEqual(["c"]);
  });

  it("renumbers within one save too, keeps prefixes and width, and ignores text that isn't a number", () => {
    const out = renumberTaken(
      blueprint,
      [order("a", "BK-0099")],
      [order("b", "BK-0099"), order("c", "BK-0099"), order("d", "Walk-in")],
    );
    expect(out.records.map((r) => r.data[code])).toEqual(["BK-0100", "BK-0101", "Walk-in"]);
  });
});
