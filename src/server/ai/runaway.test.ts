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
  it("stops text that goes round in circles without repeating exactly", () => {
    const words =
      "cool done very soon easily ready go now instantly please very nicely today perfect alright great thanks".split(
        " ",
      );
    let salad = "";
    for (let i = 0; salad.length < 6000; i++) salad += `${words[(i * 7) % words.length]} `;
    const result = watch(JSON.stringify({ reply: salad }), 24_000);
    expect(result?.why).toBe("text that goes round in circles");
    expect(result?.at).toBeLessThan(3000);
    // Repeated cards on a page aren't a loop.
    const cards = Array.from(
      { length: 30 },
      (_, i) =>
        `<div class="card"><h3>Court ${i + 1}</h3><p>Indoor, lights, ${i % 2 ? "glass walls" : "open air"}</p></div>`,
    ).join("");
    expect(watch(JSON.stringify({ starter: cards }), 24_000)).toBeNull();
  });

  it("stops a short phrase that repeats, long before the length limit", () => {
    const loop = JSON.stringify({ reply: `Here is the plan: ${"complete matches ".repeat(200)}` });
    const result = watch(loop, 24_000);
    expect(result?.why).toBe("text that repeats itself");
    expect(result?.at).toBeLessThan(600);
    // Markup that repeats a little (a row of five stars) is fine.
    const stars = JSON.stringify({ starter: `<p>${'<span class="star">★</span>'.repeat(5)}</p>`.repeat(3) });
    expect(watch(stars, 24_000)).toBeNull();
  });

  it("leaves a drafted HTML page alone, inline CSS and all", () => {
    const css =
      "body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0b1120 0%,#13294b 55%,#1e3a8a 100%);color:#e2e8f0;min-height:100vh}";
    const html = `<!doctype html><html><head><style>${css.repeat(20)}</style></head><body>${'<section class="hero"><h1>Summer League</h1></section>'.repeat(60)}</body></html>`;
    expect(watch(JSON.stringify({ starter: html }), 24_000)).toBeNull();
    expect(watch(JSON.stringify({ starter: html }))).toEqual({
      why: "a text value that never ends",
      at: expect.any(Number),
    });
  });

  it("leaves real designs and long, ordinary text alone", () => {
    expect(watch(JSON.stringify(courtBookingsSample(NOW)))).toBeNull();
    expect(watch(JSON.stringify(posSample(NOW)))).toBeNull();
    const page = {
      // Long, ordinary prose: forty different house rules.
      starter: "## House rules\n\n".concat(
        Array.from(
          { length: 40 },
          (_, i) =>
            `${i + 1}. ${["Bring clean court shoes", "Refill your own water bottle", "Book slots in advance", "Return rented paddles", "Keep the lounge tidy", "Respect quiet hours after ten", "Report damaged nets to staff", "Children need an adult with them"][i % 8]} ${["on weekdays", "during tournaments", "after league nights", "before open play", "when courts are full"][i % 5]}.`,
        ).join("\n"),
      ),
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
    // Caught as soon as the phrase has repeated for a few hundred characters, well before the length limit.
    expect(result?.why).toBe("text that repeats itself");
    expect(result?.at).toBeLessThan(600);
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
