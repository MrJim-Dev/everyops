import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resultTypeOf } from "@/server/ai/design";
import { run } from "./expr";

// Fri, Oct 16, 2026, 9 AM in Manila: the week runs Mon Oct 12 to Sun Oct 18.
const now = new Date("2026-10-16T01:00:00Z");
const at = (date: unknown) =>
  run("is_this_week(d)", { get: ([k]) => (k === "d" ? (date as never) : undefined), now });

describe("is_this_week", () => {
  it("is Monday to Sunday of this week in Manila, for dates, date-times and time ranges", () => {
    expect(at("2026-10-12")).toBe(true);
    expect(at("2026-10-18")).toBe(true);
    expect(at("2026-10-11")).toBe(false);
    expect(at("2026-10-19")).toBe(false);
    // 11 PM UTC on the 18th is Monday the 19th in Manila.
    expect(at("2026-10-18T16:30:00Z")).toBe(false);
    expect(at({ start: "2026-10-13T02:00:00Z", end: "2026-10-13T03:00:00Z" })).toBe(true);
    expect(at(null)).toBe(false);
  });
});

describe("resultTypeOf", () => {
  it("maps the result types Gemini invents to the app's own", () => {
    expect(resultTypeOf("Percent")).toBe("number");
    expect(resultTypeOf("integer")).toBe("number");
    expect(resultTypeOf("currency")).toBe("money");
    expect(resultTypeOf("boolean")).toBe("checkbox");
    expect(resultTypeOf(" Money ")).toBe("money");
    expect(resultTypeOf("emoji")).toBe("emoji");
  });
});
