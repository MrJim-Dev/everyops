import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ db: {} }));

import { slidingCount } from "./rate-limit";

const MINUTE = 60_000;

describe("slidingCount", () => {
  it("still counts a burst from the end of the last window early in the next one", () => {
    // 30 requests at 9:59, then one at 10:01: most of the burst is within the last 10 minutes.
    expect(slidingCount(30, 1, 1 * MINUTE)).toBeCloseTo(28);
  });

  it("lets the previous window fade out as the current one goes on", () => {
    expect(slidingCount(30, 1, 5 * MINUTE)).toBeCloseTo(16);
    expect(slidingCount(30, 1, 10 * MINUTE)).toBe(1);
  });

  it("works the same over shorter windows (a public page's 1-minute data limit)", () => {
    expect(slidingCount(120, 10, 15_000, MINUTE)).toBeCloseTo(100);
    expect(slidingCount(120, 10, MINUTE, MINUTE)).toBe(10);
  });
});
