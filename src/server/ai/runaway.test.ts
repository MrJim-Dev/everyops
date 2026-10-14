import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { posSample } from "@/lib/catalog/canteen-pos";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { runawayWatcher } from "./gemini";

/** Feeds text in small pieces, the way a stream arrives, and returns the first reason given (or null). */
function watch(text: string, maxStringChars?: number) {
  const check = runawayWatcher(maxStringChars);
  for (let i = 0; i < text.length; i += 37) {
    const why = check(text.slice(i, i + 37));
    if (why) return { why, at: i };
  }
  return null;
}

const NOW = new Date("2026-10-14T03:00:00Z");

describe("runaway answers", () => {
  it("leaves real designs and long, ordinary text alone", () => {
    expect(watch(JSON.stringify(courtBookingsSample(NOW)))).toBeNull();
    expect(watch(JSON.stringify(posSample(NOW)))).toBeNull();
    const page = {
      starter: "## House rules\n\n".concat("Bring clean court shoes and your own water bottle. ".repeat(40)),
    };
    expect(watch(JSON.stringify(page))).toBeNull();
    expect(
      watch(
        JSON.stringify({
          path: "/api/files/court-house/3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e.jpg",
          amount: 1250.5,
        }),
      ),
    ).toBeNull();
  });

  // The three kinds Gemini produced for real pickleball and salon briefs on Oct 14.
  it("stops a label that turns into endless filler", () => {
    const start =
      '{"views":[{"type":"approval","approveLabel":"Verify & Confirm","rejectLabel":"Cancel Booking';
    const result = watch(start + "_done_now_perfectly_setup_now_as_follows_below".repeat(20));
    expect(result?.why).toBe("text with no spaces that never ends");
    expect(result?.at).toBeLessThan(start.length + 300);
  });

  it("stops prose that never ends", () => {
    const result = watch(`{"heading":"Play 24/7","subheading":"${"Book! Enjoy! Go! ".repeat(400)}`);
    expect(result?.why).toBe("a text value that never ends");
  });

  it("stops a number that never ends", () => {
    const result = watch(`{"widgets":[{"type":"chart","target":50000.${"0".repeat(200)}`);
    expect(result?.why).toBe("a number that never ends");
  });

  it("isn't fooled by quotes and backslashes inside text", () => {
    const text = JSON.stringify({ a: 'He said "hi" \\ then left', b: "x".repeat(150) });
    expect(watch(text)).toBeNull();
  });
});
