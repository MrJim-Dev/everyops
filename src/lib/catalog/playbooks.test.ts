import { describe, expect, it } from "vitest";
import { matchPlaybooks } from "./playbooks";

describe("matchPlaybooks", () => {
  it("knows what a pickleball venue runs on", () => {
    const [courts] = matchPlaybooks("I have a pickleball place with 2 courts, I want a booking system");
    expect(courts?.id).toBe("courts");
    // The things the owner didn't say but will need: a public page in steps, add-ons, payments.
    expect(courts?.needs).toMatch(/public booking page in steps/i);
    expect(courts?.needs).toMatch(/add-ons/i);
    expect(courts?.references).toContain("court-bookings");
  });

  it("matches other kinds of business and nothing for unrelated text", () => {
    expect(matchPlaybooks("nail salon with 3 technicians")[0]?.id).toBe("salon");
    expect(matchPlaybooks("6 beach cottages for rent")[0]?.id).toBe("stays");
    expect(matchPlaybooks("hello there")).toEqual([]);
  });
});
