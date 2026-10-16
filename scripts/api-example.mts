/**
 * End-to-end check of the REST API through its TypeScript client: lists workspaces, pages through records, then
 * creates a player and a booking, confirms it with its rev, shows a stale rev is refused, and deletes both.
 *
 *   EVERYOPS_API_KEY=eo_live_… EVERYOPS_WORKSPACE=<id> tsx scripts/api-example.mts [http://localhost:3000/api/v1]
 */
import { EveryOps, EveryOpsError } from "@/lib/api/client";

const key = process.env.EVERYOPS_API_KEY;
const ws = process.env.EVERYOPS_WORKSPACE;
if (!key || !ws) throw new Error("Set EVERYOPS_API_KEY and EVERYOPS_WORKSPACE.");
const eo = new EveryOps(key, process.argv[2]);

const { data: workspaces } = await eo.listWorkspaces();
console.log("workspaces:", workspaces.map((w) => `${w.name} (${w.role})`).join(", "));

let n = 0;
for await (const _line of eo.allRecords(ws, { type: "order_line_item", limit: 2 })) n++;
console.log("order lines, following cursors 2 at a time:", n);

const player = (await eo.createRecord(ws, "players", { Name: "API Example Player", phone: "0917 000 0000" }))
  .data;
const booking = (
  await eo.createRecord(ws, "bookings", {
    player: "API Example Player",
    court: "Court 1 - Badminton",
    status: "Pending Payment",
    slot: { start: "2026-10-22 07:00", end: "2026-10-22 08:00" },
  })
).data;
console.log("created", booking.booking_ref, booking.id, "rev", booking.rev, "total", booking.total_amount);

const confirmed = (await eo.updateRecord(ws, booking.id, { status: "Confirmed" }, booking.rev)).data;
console.log("confirmed: status", confirmed.status, "rev", confirmed.rev);

try {
  await eo.updateRecord(ws, booking.id, { status: "Cancelled" }, booking.rev);
} catch (e) {
  if (!(e instanceof EveryOpsError) || e.status !== 409) throw e;
  const current = (e.details as { current: { status: string; rev: number } }).current;
  console.log("stale rev refused:", e.status, e.code, "- current status", current.status, "rev", current.rev);
}

await eo.deleteRecord(ws, booking.id, confirmed.rev);
await eo.deleteRecord(ws, player.id);
const left = await eo.listRecords(ws, { type: "players", q: "API Example Player" });
console.log("deleted; players left with that name:", left.meta.total);
