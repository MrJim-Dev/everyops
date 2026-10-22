/**
 * A large synthetic workspace for checking paging in a browser, against a LOCAL database only: the court bookings
 * sample with N extra past bookings (default 20,000), spread over the last two years.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-paging.mts [N]
 */
import { sql } from "kysely";
import type { DataRecord } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-paging";
const OWNER = { name: "Ana Cruz", email: "qa-paging@everyops.test", password: "qa-paging-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const extra = Number(process.argv[2] ?? 20_000);
  const now = new Date();
  const name = "Court House PH";
  const { blueprint: bp, records } = courtBookingsSample(now, name);
  const courts = records.filter((r) => r.entityId === "court");
  const players = records.filter((r) => r.entityId === "player");
  const methods = ["cash", "gcash", "maya"];
  const more: DataRecord[] = [];
  for (let i = 0; i < extra; i++) {
    const day = new Date(now.getTime() - (2 + (i % 720)) * 86_400_000);
    const hour = 6 + (Math.floor(i / 720) % 16);
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 8));
    const at = start.toISOString();
    more.push({
      id: `old_${i}`,
      entityId: "booking",
      data: {
        court: courts[Math.floor(i / 11_520 + i) % courts.length].id,
        player: players[(i * 7) % players.length].id,
        slot: { start: at, end: new Date(start.getTime() + 3_600_000).toISOString() },
        status: i % 23 === 0 ? "cancelled" : "paid",
        method: methods[i % 3],
        source: "walk_in",
      },
      createdAt: at,
      updatedAt: at,
    });
  }
  const all = computeAll(bp, [...records, ...more], now);
  // Every booking, newest first, with no filter: the table a busy court's history makes.
  bp.views.push({
    id: "every_booking",
    entityId: "booking",
    name: "Every booking",
    type: "table",
    fieldIds: ["slot", "court", "player", "status", "method", "amount"],
    sort: [{ fieldId: "slot", dir: "desc" }],
    totals: true,
  });
  bp.systems.find((s) => s.viewIds.includes("all_bookings"))?.viewIds.push("every_booking");
  // A board by payment, and bookings listed on their player's panel (as line items), for the older-records loaders.
  bp.views.push({
    id: "payment_board",
    entityId: "booking",
    name: "Payment board",
    type: "kanban",
    statusFieldId: "status",
    cardFieldIds: ["slot", "court"],
  });
  bp.systems.find((s) => s.viewIds.includes("all_bookings"))?.viewIds.push("payment_board");
  const booking = bp.entities.find((e) => e.id === "booking");
  if (booking) booking.parent = { entityId: "player", fieldId: "player" };
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Court bookings", createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [bp], records: all, changes: [], docs: {} }),
    );
  console.log(
    JSON.stringify({
      workspace: SLUG,
      records: all.length,
      bookings: all.filter((r) => r.entityId === "booking").length,
    }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
