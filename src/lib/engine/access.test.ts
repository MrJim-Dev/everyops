import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { f } from "@/lib/catalog/define";
import { canSee, guardWrites, type Viewer, visibleTo } from "./access";
import { computeAll } from "./compute";

const NOW = new Date("2026-10-22T03:00:00Z");
const sample = courtBookingsSample(NOW);
const bp: Blueprint = structuredClone(sample.blueprint);
const booking = bp.entities.find((e) => e.id === "booking");
if (!booking) throw new Error("sample");
booking.fields.push(f.person("coach", "Coach"));
booking.access = { by: "coach" };
const records: DataRecord[] = computeAll(
  bp,
  sample.records.map((r, i) =>
    r.entityId === "booking" ? { ...r, data: { ...r.data, coach: i % 2 ? "Ben Lim" : "Cy Tan" } } : r,
  ),
  NOW,
);
const ben: Viewer = { userId: "u_ben", role: "staff", name: "Ben Lim", email: "ben@court.ph" };
const owner: Viewer = { ...ben, userId: "u_ana", role: "owner", name: "Ana Cruz" };
const bookings = records.filter((r) => r.entityId === "booking");
const mine = bookings.find((r) => r.data.coach === "Ben Lim") as DataRecord;
const theirs = bookings.find((r) => r.data.coach === "Cy Tan") as DataRecord;
const stored = records.map((record) => ({ record, rev: 1 }));

describe("record-level access", () => {
  it("shows staff only their records of a limited type, by name or email, and everything else", () => {
    expect(canSee(bp, ben, mine)).toBe(true);
    expect(canSee(bp, ben, theirs)).toBe(false);
    expect(
      canSee(bp, { ...ben, name: "" }, { ...theirs, data: { ...theirs.data, coach: " BEN@court.ph " } }),
    ).toBe(true);
    const seen = visibleTo(bp, ben, records);
    expect(seen.filter((r) => r.entityId === "booking").every((r) => r.data.coach === "Ben Lim")).toBe(true);
    expect(seen.filter((r) => r.entityId === "player")).toHaveLength(
      records.filter((r) => r.entityId === "player").length,
    );
  });

  it("lets owners and admins see everything", () => {
    expect(visibleTo(bp, owner, records)).toHaveLength(records.length);
    expect(canSee(bp, { ...ben, role: "admin" }, theirs)).toBe(true);
  });

  it("limits by who added a record", () => {
    const added = {
      ...bp,
      entities: bp.entities.map((e) => (e.id === "booking" ? { ...e, access: { by: "created_by" } } : e)),
    };
    expect(
      canSee(added, ben, { ...theirs, createdBy: { type: "person", id: "u_ben", name: "Ben Lim" } }),
    ).toBe(true);
    expect(canSee(added, ben, theirs)).toBe(false);
  });

  it("refuses changes to records a member can't see", () => {
    const edit = { record: { ...theirs, data: { ...theirs.data, status: "paid" } }, rev: 1 };
    expect(guardWrites(bp, ben, stored, [edit], [], NOW)).toEqual({
      ok: false,
      message: "You can only change the bookings you can see.",
    });
    expect(guardWrites(bp, ben, stored, [], [{ id: theirs.id }], NOW).ok).toBe(false);
  });

  it("works totals out from every record, not the member's partial copy", () => {
    const player = records.find((r) => r.id === mine.data.player) as DataRecord;
    // Their browser recounted the player's bookings from the ones it has: a smaller total, and nothing else.
    const undercount = { record: { ...player, data: { ...player.data, visits: 1 } }, rev: 1 };
    const paid = { record: { ...mine, data: { ...mine.data, status: "cancelled" } }, rev: 1 };
    const result = guardWrites(bp, ben, stored, [undercount, paid], [], NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.puts.find((p) => p.record.id === player.id && p.record.data.visits === 1)).toBeUndefined();
    expect(result.puts.find((p) => p.record.id === mine.id)?.record.data.status).toBe("cancelled");
  });
});
