import { describe, expect, it } from "vitest";
import { joinSlots, type Slot, slotRangeProblem } from "./slots";

const hours = { opensAt: "06:00", closesAt: "23:00", slotMinutes: 60 };
const r = (from: string, to: string) => ({
  start: `2026-10-15T${from}:00+08:00`,
  end: `2026-10-15T${to}:00+08:00`,
});

describe("picked booking ranges", () => {
  it("allows several slots in a row unless the form books one at a time", () => {
    expect(slotRangeProblem(r("16:00", "17:00"), hours, true)).toBeNull();
    expect(slotRangeProblem(r("16:00", "19:00"), hours, true)).toBeNull();
    expect(slotRangeProblem(r("16:00", "17:00"), hours, false)).toBeNull();
    expect(slotRangeProblem(r("16:00", "18:00"), hours, false)).toContain("one time slot");
  });

  it("refuses ranges off the slot grid or outside opening hours", () => {
    expect(slotRangeProblem(r("16:30", "17:30"), hours, true)).toContain("open times");
    expect(slotRangeProblem(r("22:00", "23:30"), hours, true)).toContain("open times");
    expect(slotRangeProblem(r("05:00", "06:00"), hours, true)).toContain("open times");
    expect(slotRangeProblem(r("17:00", "16:00"), hours, true)).toBe("Pick a time.");
  });
});

describe("joining slots", () => {
  const slot = (h: number, free = true): Slot => ({
    start: `2026-10-15T${String(h).padStart(2, "0")}:00:00.000Z`,
    end: `2026-10-15T${String(h + 1).padStart(2, "0")}:00:00.000Z`,
    free,
  });
  const day = [slot(8), slot(9), slot(10, false), slot(11), slot(12)];

  it("joins free slots in either direction", () => {
    expect(joinSlots(day, day[0].start, day[1].start)).toEqual({ start: day[0].start, end: day[1].end });
    expect(joinSlots(day, day[4].start, day[3].start)).toEqual({ start: day[3].start, end: day[4].end });
  });

  it("won't join across a taken slot", () => {
    expect(joinSlots(day, day[1].start, day[3].start)).toBeNull();
  });
});
