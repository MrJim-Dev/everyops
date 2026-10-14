import { describe, expect, it } from "vitest";
import { idFromPrompt } from "./workspace-model";

describe("a new workspace's address", () => {
  it("comes from what the owner described", () => {
    expect(idFromPrompt("I run a small sari-sari store and mini grocery in Cebu with 2 cashiers")).toMatch(
      /^sari-sari-store-mini-grocery-[0-9a-f]{4}$/,
    );
    expect(idFromPrompt("Need a booking system for our 4 pickleball courts")).toMatch(
      /^booking-pickleball-courts-[0-9a-f]{4}$/,
    );
  });

  it("still works for a prompt with nothing to name it by", () => {
    expect(idFromPrompt("I need a system")).toMatch(/^workspace-[0-9a-f]{4}$/);
  });
});
