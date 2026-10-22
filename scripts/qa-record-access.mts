/**
 * A synthetic workspace for checking record-level access in a browser, against a LOCAL database only: the court
 * bookings sample with a Coach on each booking (Ben Lim or Cy Tan), an owner (Ana Cruz) and both coaches as staff.
 * The owner limits bookings in Settings → Team.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-record-access.mts
 */
import { sql } from "kysely";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-record-access";
const PASSWORD = "qa-access-2026";
const OWNER = { name: "Ana Cruz", email: "qa-access@everyops.test", password: PASSWORD };
const COACHES = [
  { name: "Ben Lim", email: "qa-access-ben@everyops.test", password: PASSWORD },
  { name: "Cy Tan", email: "qa-access-cy@everyops.test", password: PASSWORD },
];

async function userId(u: typeof OWNER): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${u.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: u })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Court House PH";
  const { blueprint: bp, records } = courtBookingsSample(now, name);
  const booking = bp.entities.find((e) => e.id === "booking");
  if (!booking) throw new Error("Sample changed.");
  booking.fields.push(f.person("coach", "Coach"));
  let i = 0;
  for (const r of records.filter((r) => r.entityId === "booking")) r.data.coach = COACHES[i++ % 2].name;
  for (const v of bp.views)
    if (v.entityId === "booking" && v.type === "table" && !v.fieldIds.includes("coach"))
      v.fieldIds.push("coach");
  const owner = await userId(OWNER);
  const coaches = await Promise.all(COACHES.map(userId));
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Court bookings", createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  for (const c of coaches)
    await sql`insert into workspace_member (workspace_id, user_id, role) values (${SLUG}, ${c}, 'staff')`.execute(
      db,
    );
  await db.transaction().execute((trx) =>
    writeContent(trx, SLUG, {
      slug: SLUG,
      ...meta,
      versions: [bp],
      records: computeAll(bp, records, now),
      changes: [],
      docs: {},
    }),
  );
  const count = (n: string) => records.filter((r) => r.entityId === "booking" && r.data.coach === n).length;
  console.log(JSON.stringify({ workspace: SLUG, ben: count("Ben Lim"), cy: count("Cy Tan") }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
