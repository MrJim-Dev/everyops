import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint/types";
import { overlapNote } from "./overlaps";

const bp = {
  entities: [
    {
      id: "booking",
      name: "Booking",
      pluralName: "Bookings",
      primaryFieldId: "booking_ref",
      fields: [
        { id: "booking_ref", name: "Ref", type: "text" },
        { id: "slot", name: "Slot", type: "time_range" },
      ],
    },
  ],
} as unknown as Blueprint;

const bookings = {
  name: "search_records",
  args: { entityId: "booking" },
  result: {
    total: 2,
    records: [
      {
        id: "b1",
        booking_ref: "BK-001",
        slot: { start: "2026-10-14T10:00:00.000Z", end: "2026-10-14T11:00:00.000Z" },
      },
      { id: "b2", booking_ref: "BK-002", slot: { start: "2026-10-16T20:00", end: "2026-10-16T21:00" } },
    ],
  },
};
const calendar = (events: unknown) => ({
  name: "calendar__list_events",
  args: {},
  result: { result: JSON.stringify(events) },
});

describe("overlapNote", () => {
  it("finds every overlap, with Manila times and minutes", () => {
    const note = overlapNote(bp, [
      bookings,
      calendar({
        events: [
          {
            summary: "Supplier meeting",
            start: "2026-10-14T17:30:00+08:00",
            end: "2026-10-14T18:30:00+08:00",
          },
          {
            summary: "Dentist",
            start: { dateTime: "2026-10-16T15:00:00+08:00" },
            end: { dateTime: "2026-10-16T16:00:00+08:00" },
          },
          { summary: "Dinner", start: "2026-10-16T20:30:00+08:00", end: "2026-10-16T22:00:00+08:00" },
        ],
      }),
    ]);
    expect(note).toContain("Booking BK-001");
    expect(note).toContain('"Supplier meeting"');
    expect(note).toContain("by 30 min");
    expect(note).toContain("Booking BK-002");
    expect(note).toContain('"Dinner"');
    expect(note).not.toContain("Dentist");
  });

  it("says so when nothing overlaps, and stays quiet without both sides", () => {
    expect(
      overlapNote(bp, [
        bookings,
        calendar({
          events: [{ summary: "Gym", start: "2026-10-15T06:00:00+08:00", end: "2026-10-15T07:00:00+08:00" }],
        }),
      ]),
    ).toMatch(/^No record overlaps/);
    expect(overlapNote(bp, [bookings])).toBeNull();
  });
});
