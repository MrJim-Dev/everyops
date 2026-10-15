import type { DataRecord } from "@/lib/blueprint/types";
import { courtBookingsBlueprint } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { addDays, at, todayKey } from "@/lib/time";

/** Known amounts and boundary cases; never copy mutable demo/customer data into an evaluation. */
export function qualityFixture() {
  const today = todayKey();
  const now = new Date().toISOString();
  const record = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
    id,
    entityId,
    data,
    createdAt: now,
    updatedAt: now,
  });
  const player = (id: string, name: string) => record(id, "player", { name, phone: "" });
  const booking = (
    id: string,
    person: string,
    name: string,
    day: string,
    start: number,
    hours: number,
    status: string,
    method = "cash",
  ) =>
    record(id, "booking", {
      player: person,
      player_name: name,
      court: "quality-court",
      status,
      method,
      source: "walk_in",
      slot: {
        start: at(day, `${String(start).padStart(2, "0")}:00`),
        end: at(day, `${String(start + hours).padStart(2, "0")}:00`),
      },
      rate: 400,
      amount: 400 * hours,
    });
  const records = [
    record("quality-court", "court", { name: "Court 1", surface: "indoor" }),
    player("quality-ana", "Ana Reyes"),
    player("quality-bea", "Bea Lim"),
    player("quality-miguel", "Miguel Santos"),
    booking("quality-paid-ana", "quality-ana", "Ana Reyes", today, 6, 1, "paid", "gcash"),
    booking("quality-paid-bea", "quality-bea", "Bea Lim", today, 7, 2, "paid", "cash"),
    booking("quality-unpaid-miguel", "quality-miguel", "Miguel Santos", today, 9, 2, "unpaid"),
    booking("quality-cancelled", "quality-ana", "Ana Reyes", today, 11, 4, "cancelled"),
    booking("quality-old", "quality-bea", "Bea Lim", addDays(`${today.slice(0, 7)}-01`, -1), 6, 3, "paid"),
    // More than the digest's 25-record cap, so exact filtered results require the real SQL tools.
    ...Array.from({ length: 27 }, (_, i) =>
      booking(`quality-archive-${i}`, "quality-ana", "Ana Reyes", addDays(today, -90 - i), 6, 1, "cancelled"),
    ),
  ];
  const blueprint = courtBookingsBlueprint("Rally House · AI quality");
  return {
    blueprint,
    records: computeAll(blueprint, records),
    expected: { monthlyCollected: 1200, gcashCollected: 400, unpaidId: "quality-unpaid-miguel" },
  };
}
