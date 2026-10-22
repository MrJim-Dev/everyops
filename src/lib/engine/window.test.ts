import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll, setPartialTypes } from "./compute";
import { inWindow, WINDOW_AT, WINDOW_DAYS, windowBlocker, windowRecords } from "./window";

const NOW = new Date("2026-10-22T03:00:00Z");
const sample = courtBookingsSample(NOW);
const bp: Blueprint = sample.blueprint;
const booking = bp.entities.find((e) => e.id === "booking");
if (!booking) throw new Error("sample");
const old = (i: number, daysAgo: number): DataRecord => {
  const start = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `old_${i}`,
    entityId: "booking",
    data: { ...sample.records.find((r) => r.entityId === "booking")?.data, slot: { start, end: start } },
    createdAt: start,
    updatedAt: start,
  };
};

describe("windowed record types", () => {
  it("windows the court sample's bookings: every card on its dashboard is about recent or upcoming days", () => {
    expect(windowBlocker(bp, "booking")).toBeNull();
  });

  it("doesn't window a type a card adds up in full, or one an automation files records under", () => {
    const allTime = {
      ...bp,
      widgets: [
        ...bp.widgets,
        {
          ...bp.widgets[0],
          id: "all",
          title: "All bookings",
          compare: undefined,
          filter: "status != 'cancelled'",
          type: "stat" as const,
        },
      ],
    };
    expect(windowBlocker(allTime, "booking")).toMatch(/All bookings/);
    const negated = {
      ...bp,
      widgets: [
        { ...bp.widgets[0], compare: undefined, filter: "!is_upcoming(slot)", type: "stat" as const },
      ],
    };
    expect(windowBlocker(negated, "booking")).not.toBeNull();
  });

  it("keeps recent, upcoming and lately changed records, by the booking time", () => {
    expect(inWindow(booking, old(1, WINDOW_DAYS - 5), NOW)).toBe(true);
    expect(inWindow(booking, old(2, WINDOW_DAYS + 30), NOW)).toBe(false);
    expect(inWindow(booking, { ...old(3, 400), updatedAt: NOW.toISOString() }, NOW)).toBe(true);
  });

  it("windows only large types, and says how many there are", () => {
    const many = [
      ...sample.records,
      ...Array.from({ length: WINDOW_AT + 10 }, (_, i) => old(i, 300 + (i % 50))),
    ];
    const { rows, windowed } = windowRecords(
      bp,
      many.map((record) => ({ record })),
      NOW,
    );
    expect(Object.keys(windowed)).toEqual(["booking"]);
    expect(windowed.booking.total).toBe(many.filter((r) => r.entityId === "booking").length);
    expect(rows.length).toBe(sample.records.length);
    expect(
      windowRecords(
        bp,
        sample.records.map((record) => ({ record })),
        NOW,
      ).windowed,
    ).toEqual({});
  });

  it("keeps the server's totals over a windowed type in the browser", () => {
    const player = computeAll(bp, sample.records, NOW).find((r) => r.entityId === "player") as DataRecord;
    const stored = { ...player, data: { ...player.data, visits: 999 } };
    setPartialTypes(["booking"]);
    try {
      const kept = computeAll(bp, [...sample.records.filter((r) => r.id !== player.id), stored], NOW);
      expect(kept.find((r) => r.id === player.id)?.data.visits).toBe(999);
    } finally {
      setPartialTypes([]);
    }
    const counted = computeAll(bp, [...sample.records.filter((r) => r.id !== player.id), stored], NOW);
    expect(counted.find((r) => r.id === player.id)?.data.visits).not.toBe(999);
  });
});
