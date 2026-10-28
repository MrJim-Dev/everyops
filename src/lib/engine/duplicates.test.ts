import { describe, expect, it } from "vitest";
import { getEntity } from "@/lib/blueprint/lookup";
import type { DataRecord } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { findDuplicates, linkCount, matchFields, mergeInto, mergeSummary } from "./duplicates";

const NOW = new Date("2026-10-13T09:30:00+08:00");

function withTwin() {
  const ws = courtBookingsSample(NOW);
  const players = ws.records.filter((r) => r.entityId === "player");
  const kevin = players.find((r) => r.data.name === "Kevin Sy");
  if (!kevin) throw new Error("fixture changed");
  // The same player added again from a form: another spelling, the phone with a country code, no other details.
  const twin: DataRecord = {
    id: "player_twin",
    entityId: "player",
    data: { name: "Kevin S.", phone: `+63 ${String(kevin.data.phone).replace(/^0/, "")}` },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const booking = ws.records.find((r) => r.entityId === "booking" && r.data.player === kevin.id);
  if (!booking) throw new Error("fixture changed");
  const moved: DataRecord = { ...booking, id: "booking_twin", data: { ...booking.data, player: twin.id } };
  return { ws: { ...ws, records: [...ws.records, twin, moved] }, kevin, twin };
}

describe("duplicates", () => {
  it("compares phone text fields loosely and never matches a record with itself", () => {
    const { ws, kevin, twin } = withTwin();
    const player = getEntity(ws.blueprint, "player");
    expect(matchFields(player).map((f) => f.id)).toEqual(["phone"]);
    expect(findDuplicates(player, twin.data, ws.records, twin.id).map((m) => m.record.id)).toEqual([
      kevin.id,
    ]);
    expect(findDuplicates(player, { phone: "0999 000 0000" }, ws.records)).toEqual([]);
    expect(findDuplicates(player, { name: "No phone" }, ws.records)).toEqual([]);
  });

  it("merges into the kept record: links move, totals add up, the other is gone", () => {
    const { ws, kevin, twin } = withTwin();
    const before = linkCount(ws, kevin) + linkCount(ws, twin);
    const merged = mergeInto(ws, kevin.id, twin.id, NOW);
    if (!merged.ok) throw new Error(merged.message);
    expect(merged.moved).toBe(1);
    expect(merged.data.records.some((r) => r.id === twin.id)).toBe(false);
    expect(linkCount(merged.data, merged.record)).toBe(before);
    expect(merged.record.data.visits).toBe(before);
    expect(merged.record.data.name).toBe("Kevin Sy");
  });

  it("says what moved and how many the kept record has now", () => {
    const { ws, kevin, twin } = withTwin();
    const total = linkCount(ws, kevin) + linkCount(ws, twin);
    const merged = mergeInto(ws, kevin.id, twin.id, NOW);
    if (!merged.ok) throw new Error(merged.message);
    const player = getEntity(ws.blueprint, "player");
    expect(merged.totals.map((t) => [t.entity.id, t.count])).toEqual([["booking", total]]);
    expect(mergeSummary(player, merged)).toBe(
      `Moved 1 linked record. Kevin Sy now has all ${total} bookings.`,
    );
    const bare = { ...ws, records: ws.records.filter((r) => r.id !== "booking_twin") };
    const nothing = mergeInto(bare, kevin.id, twin.id, NOW);
    if (!nothing.ok) throw new Error(nothing.message);
    expect(nothing.moved).toBe(0);
    expect(mergeSummary(player, nothing)).toBe("");
  });

  it("fills the kept record's empty fields from the other", () => {
    const { ws, kevin, twin } = withTwin();
    const merged = mergeInto(ws, twin.id, kevin.id, NOW);
    if (!merged.ok) throw new Error(merged.message);
    expect(merged.record.data.name).toBe("Kevin S.");
    expect(merged.filled).toEqual([]);
    const blank = {
      ...ws,
      records: ws.records.map((r) => (r.id === twin.id ? { ...r, data: { name: "Kevin S." } } : r)),
    };
    const filled = mergeInto(blank, twin.id, kevin.id, NOW);
    if (!filled.ok) throw new Error(filled.message);
    expect(filled.filled).toEqual(["phone"]);
    expect(filled.record.data.phone).toBe(kevin.data.phone);
  });

  it("refuses records of different types or the same record", () => {
    const { ws, kevin } = withTwin();
    const court = ws.records.find((r) => r.entityId === "court");
    expect(mergeInto(ws, kevin.id, kevin.id).ok).toBe(false);
    expect(mergeInto(ws, kevin.id, court?.id ?? "").ok).toBe(false);
  });
});
