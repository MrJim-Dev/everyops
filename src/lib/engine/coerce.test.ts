import { describe, expect, it } from "vitest";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { coerceValues } from "./coerce";

const NOW = new Date("2026-10-16T03:00:00Z");
const { blueprint: bp, records } = courtBookingsSample(NOW);
const booking = bp.entities.find((e) => e.id === "booking");
if (!booking) throw new Error("sample");

describe("coerceValues", () => {
  it("takes fields by id or name, choices by label, links by name, and Manila times", () => {
    const court = records.find((r) => r.entityId === "court");
    const player = records.find((r) => r.entityId === "player");
    const { data, errors } = coerceValues(bp, records, booking, {
      Court: court?.data.name,
      player: player?.data.name,
      slot: { start: "2026-11-02 18:00", end: "2026-11-02T19:00" },
      Payment: "Paid",
      method: "gcash",
    });
    expect(errors).toEqual([]);
    expect(data).toEqual({
      court: court?.id,
      player: player?.id,
      slot: { start: "2026-11-02T10:00:00.000Z", end: "2026-11-02T11:00:00.000Z" },
      status: "paid",
      method: "gcash",
    });
  });

  it("names every value that doesn't fit, with what it needs", () => {
    const { errors } = coerceValues(bp, records, booking, {
      court: "Court 99",
      status: "Maybe",
      amount: 500,
      nickname: "x",
    });
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/Court \(court\) needs a court id or name; no court "Court 99"/);
    expect(errors[1]).toMatch(/needs one of: Unpaid, Paid, Cancelled/);
    expect(errors[2]).toMatch(/worked out by EveryOps/);
    expect(errors[3]).toMatch(/has no field "nickname"/);
  });
});
