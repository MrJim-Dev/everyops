import { describe, expect, it } from "vitest";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyOps } from "@/lib/engine/changes";
import { newShape, parseCanvas } from "./model";

describe("canvas pages", () => {
  it("keeps good shapes and drops broken ones, outside pictures and junk", () => {
    const good = newShape("note", 100, 100, { text: "Court 1" });
    const body = JSON.stringify({
      version: 1,
      shapes: [
        good,
        { id: "x", type: "script" },
        { type: "rect" },
        { ...newShape("image", 0, 0), src: "https://evil.example/a.png" },
        { ...newShape("rect", 0, 0), opacity: 9, width: -5 },
      ],
    });
    const doc = parseCanvas(body);
    expect(doc.shapes.map((s) => s.type)).toEqual(["note", "image", "rect"]);
    expect(doc.shapes[1].src).toBeUndefined();
    expect(doc.shapes[2]).toMatchObject({ opacity: 1, width: 1 });
    expect(parseCanvas("not json")).toEqual({ version: 1, shapes: [] });
  });

  it("is a valid page without a record type", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-14T09:00:00+08:00"));
    const bp = applyOps(blueprint, [
      {
        op: "add_system",
        system: { id: "plan", name: "Floor plan", icon: "image", viewIds: [], widgetIds: [] },
      },
      {
        op: "add_view",
        systemId: "plan",
        view: { id: "floor", entityId: "", name: "Floor plan", type: "canvas" },
      },
    ]);
    expect(validateBlueprint(bp)).toEqual([]);
  });
});
