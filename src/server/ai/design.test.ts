import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { ensurePages } from "./design";

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
