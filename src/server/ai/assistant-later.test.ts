import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChangeOp } from "@/lib/engine/changes";
import { FUNCTIONS } from "@/lib/engine/expr";
import { comingDays, startsLaterProblem, withStatusOptions } from "./assistant";

const rate = (expr: string): ChangeOp => ({
  op: "update_field",
  entityId: "booking",
  fieldId: "rate",
  patch: { formula: { expr, resultType: "money" } },
});

describe("startsLaterProblem", () => {
  it("sends back a formula that applies today when the person said it starts later", () => {
    const problem = startsLaterProblem("Raise the peak rate to ₱550 starting next Monday", [rate("550")]);
    expect(problem).toContain("starting next Monday");
  });

  it("accepts a formula that waits for the date, and requests that start now", () => {
    expect(
      startsLaterProblem("Raise the peak rate to ₱550 starting next Monday", [
        rate("on_or_after(slot, '2026-10-19') ? 550 : 500"),
      ]),
    ).toBeNull();
    expect(startsLaterProblem("Raise the peak rate to ₱550", [rate("550")])).toBeNull();
  });
});

describe("on_or_after", () => {
  const ctx = { now: new Date("2026-10-15T09:00:00+08:00") } as never;
  it("compares the record's Manila date with the day given", () => {
    const slot = { start: "2026-10-18T16:30:00.000Z", end: "2026-10-18T17:30:00.000Z" }; // Oct 19, 12:30 AM in Manila
    expect(FUNCTIONS.on_or_after([slot, "2026-10-19"], ctx)).toBe(true);
    expect(FUNCTIONS.on_or_after([slot, "2026-10-20"], ctx)).toBe(false);
    expect(FUNCTIONS.on_or_after([slot, "next monday"], ctx)).toBe(false);
  });
});

describe("withStatusOptions", () => {
  it("gives a status field without choices the usual ones for what the record is", () => {
    const status = { id: "status", name: "Status", type: "status" as const };
    expect(withStatusOptions(status, "Clinic session").options?.map((o) => o.id)).toEqual([
      "scheduled",
      "done",
      "cancelled",
    ]);
    expect(withStatusOptions(status, "Supply order").options?.map((o) => o.id)).toEqual([
      "open",
      "in_progress",
      "done",
      "cancelled",
    ]);
    expect(withStatusOptions(status, "Coach").options?.map((o) => o.id)).toEqual(["active", "inactive"]);
    const own = { ...status, options: [{ id: "x", label: "X", tone: "neutral" as const }] };
    expect(withStatusOptions(own, "Coach")).toBe(own);
  });
});

describe("comingDays", () => {
  it("lists the next days with their weekday and date in Manila", () => {
    const days = comingDays("2026-10-15", 4);
    expect(days).toBe(
      "Fri, Oct 16 (2026-10-16); Sat, Oct 17 (2026-10-17); Sun, Oct 18 (2026-10-18); Mon, Oct 19 (2026-10-19)",
    );
  });
});
