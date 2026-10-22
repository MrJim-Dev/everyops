import { describe, expect, it } from "vitest";
import { getEntity } from "@/lib/blueprint/lookup";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { at } from "@/lib/time";
import { createRecord } from "./records";
import {
  createSeries,
  moveToDay,
  planSeries,
  SERIES_KEY,
  seriesDays,
  seriesOf,
  updateFollowing,
} from "./recurrence";

const NOW = new Date("2026-10-13T09:30:00+08:00");
const slotOn = (day: string, from = "19:00", to = "20:00") => ({ start: at(day, from), end: at(day, to) });

function court2Tuesday() {
  const ws = courtBookingsSample(NOW);
  const player = ws.records.find((r) => r.entityId === "player");
  if (!player) throw new Error("fixture changed");
  return { ws, input: { court: "court_2", player: player.id, status: "unpaid", slot: slotOn("2027-03-02") } };
}

describe("series days", () => {
  it("steps weekly up to a count, and by a date", () => {
    expect(seriesDays("2027-03-02", { every: "week", interval: 1, count: 3 })).toEqual([
      "2027-03-02",
      "2027-03-09",
      "2027-03-16",
    ]);
    expect(seriesDays("2027-03-02", { every: "week", interval: 2, until: "2027-03-31" })).toEqual([
      "2027-03-02",
      "2027-03-16",
      "2027-03-30",
    ]);
  });

  it("keeps the day of the month, or the month's last day when it's shorter", () => {
    expect(seriesDays("2027-01-31", { every: "month", interval: 1, count: 4 })).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("stops at MAX_REPEATS records", () => {
    expect(seriesDays("2027-01-01", { every: "day", interval: 1, until: "2030-01-01" })).toHaveLength(104);
  });
});

describe("recurring bookings", () => {
  it("keeps the wall-clock time and length on each day", () => {
    expect(moveToDay(slotOn("2027-03-02", "19:00", "20:30"), "2027-03-09")).toEqual(
      slotOn("2027-03-09", "19:00", "20:30"),
    );
    expect(moveToDay("2027-03-02", "2027-03-09")).toBe("2027-03-09");
  });

  it("skips a day that clashes with another booking and makes the rest", () => {
    const { ws, input } = court2Tuesday();
    const taken = createRecord(
      ws,
      "booking",
      { ...input, slot: slotOn("2027-03-16", "19:30", "20:30") },
      NOW,
    );
    if (!taken.ok) throw new Error(taken.errors[0].message);
    const repeat = { every: "week" as const, interval: 1, count: 4 };
    expect(planSeries(taken.data, "booking", input, repeat).map((i) => !!i.clash)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    const made = createSeries(taken.data, "booking", input, repeat, NOW);
    if (!made.ok) throw new Error(made.errors[0].message);
    expect(made.ids).toHaveLength(3);
    expect(made.skipped).toEqual(["2027-03-16"]);
    const series = seriesOf(made.data.records, made.record, getEntity(made.data.blueprint, "booking"));
    expect(series?.members.map((r) => (r.data.slot as { start: string }).start)).toEqual([
      at("2027-03-02", "19:00"),
      at("2027-03-09", "19:00"),
      at("2027-03-23", "19:00"),
    ]);
    expect(series?.repeat).toEqual({ every: "week", interval: 1 });
  });

  it("moves this and the following bookings to a new time, leaving earlier ones", () => {
    const { ws, input } = court2Tuesday();
    const made = createSeries(ws, "booking", input, { every: "week", interval: 1, count: 4 }, NOW);
    if (!made.ok) throw new Error(made.errors[0].message);
    const second = made.data.records.find((r) => r.id === made.ids[1]);
    if (!second) throw new Error("missing");
    const moved = updateFollowing(
      made.data,
      second,
      { slot: slotOn("2027-03-10", "08:00", "10:00"), status: "paid" },
      NOW,
    );
    if (!moved.ok) throw new Error(moved.errors[0].message);
    const after = made.ids.map((id) => moved.data.records.find((r) => r.id === id)?.data);
    expect(after.map((d) => (d?.slot as { start: string }).start)).toEqual([
      at("2027-03-02", "19:00"),
      at("2027-03-10", "08:00"),
      at("2027-03-17", "08:00"),
      at("2027-03-24", "08:00"),
    ]);
    expect(after.map((d) => d?.status)).toEqual(["unpaid", "paid", "paid", "paid"]);
    expect(after.every((d) => d?.[SERIES_KEY] === after[0]?.[SERIES_KEY])).toBe(true);
  });

  it("refuses the whole series when the form itself is incomplete", () => {
    const { ws, input } = court2Tuesday();
    const made = createSeries(
      ws,
      "booking",
      { ...input, court: "" },
      { every: "week", interval: 1, count: 3 },
      NOW,
    );
    expect(made.ok).toBe(false);
  });
});
