import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { ensurePages, repairStructure } from "./design";

describe("ensurePages", () => {
  it("gives a record type without any screen its own page", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    // Gemini's habit: courts and players folded into the Bookings section with no screens of their own.
    const folded = structuredClone(blueprint);
    folded.systems = folded.systems.filter((s) => s.id !== "courts" && s.id !== "players");
    folded.views = folded.views.filter((v) => v.id !== "courts_table" && v.id !== "players_table");
    const fixed = ensurePages(folded);
    const pages = fixed.systems.map((s) => s.name);
    expect(pages).toEqual(["Overview", "Bookings", "Courts", "Players"]);
    expect(fixed.systems.find((s) => s.name === "Courts")?.icon).toBe("court");
    expect(validateBlueprint(fixed)).toEqual([]);
  });

  it("leaves a workspace that already has a page per record type alone", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    expect(ensurePages(structuredClone(blueprint)).systems).toEqual(blueprint.systems);
  });
});

describe("repairStructure", () => {
  it("restores booking settings, attaches add-on lines to their booking and renames a Settings page", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const booking = bp.entities.find((e) => e.id === "booking");
    if (!booking) throw new Error("no booking");
    delete booking.booking;
    booking.fields.push({
      id: "addons_total",
      name: "Add-ons",
      type: "rollup",
      rollup: { childEntityId: "booking_addon", viaFieldId: "booking", op: "sum", fieldId: "price" },
    });
    bp.entities.push({
      id: "booking_addon",
      name: "Add-on line",
      pluralName: "Add-on lines",
      primaryFieldId: "title",
      fields: [
        { id: "title", name: "Title", type: "text" },
        { id: "booking", name: "Booking", type: "relation", relation: { entityId: "booking" } },
        { id: "price", name: "Price", type: "money" },
      ],
    });
    bp.views.push({
      id: "addon_lines",
      entityId: "booking_addon",
      name: "All",
      type: "table",
      fieldIds: ["title"],
    });
    bp.systems.push({
      id: "lines",
      name: "Add-on lines",
      icon: "package",
      viewIds: ["addon_lines"],
      widgetIds: [],
    });
    const courts = bp.systems.find((s) => s.id === "courts");
    if (courts) courts.name = "Settings";

    const fixed = repairStructure(bp);
    expect(fixed.entities.find((e) => e.id === "booking")?.booking).toMatchObject({
      resourceFieldId: "court",
      timeFieldId: "slot",
      statusFieldId: "status",
    });
    expect(fixed.entities.find((e) => e.id === "booking_addon")?.parent).toEqual({
      entityId: "booking",
      fieldId: "booking",
    });
    expect(fixed.systems.map((s) => s.name)).not.toContain("Add-on lines");
    expect(fixed.systems.find((s) => s.id === "courts")?.name).toBe("Setup");
  });
});
