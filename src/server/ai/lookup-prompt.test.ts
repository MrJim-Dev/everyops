import { describe, expect, it } from "vitest";
import { needsLookup, requiresLookupEvidence } from "./lookup-prompt";

describe("needsLookup", () => {
  it("skips greetings, navigation, statements and design changes that name no records", () => {
    for (const text of [
      "Hi!",
      "thanks",
      "Open the courts page",
      "take me to settings",
      "Add a notes field to bookings",
      "We hired coaches for weekend clinics. Add a way to track coaches and their clinic sessions.",
      "Rename the Players page to Members",
      "Remove the Rates tab",
      "Heads up: on weekends we now close at 11 PM.",
      "What should I set up next?",
      "How do I share the booking page?",
    ])
      expect(needsLookup(text), text).toBe(false);
  });

  it("looks up anything about particular records, amounts or dates", () => {
    for (const text of [
      "How much have we collected this month?",
      "Who still hasn't paid for today's bookings?",
      "Mark Miguel Santos's booking today as paid",
      "Delete Kevin Sy's Friday 8 PM booking",
      "Show me unpaid bookings",
      "Add a field for the discount we gave on order 1002",
      "What should I do about today's unpaid bookings?",
    ])
      expect(needsLookup(text), text).toBe(true);
  });

  it("doesn't insist on looked-up records for design changes that mention statuses or numbers", () => {
    const change = "Add an emergency contact phone to players and a count of only their paid bookings";
    expect(needsLookup(change)).toBe(true);
    expect(requiresLookupEvidence(change)).toBe(false);
    expect(requiresLookupEvidence("How many paid bookings did we have this month?")).toBe(true);
    expect(requiresLookupEvidence("Show me unpaid bookings")).toBe(true);
  });
});
