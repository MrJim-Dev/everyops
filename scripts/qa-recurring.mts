/**
 * A synthetic workspace for checking recurring bookings in a browser, against a LOCAL database only: the court
 * booking sample, owned by a QA account.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-recurring.mts
 */
import { sql } from "kysely";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { addDays, at, todayKey, zonedParts } from "@/lib/time";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-recurring";
const OWNER = { name: "Ana Cruz", email: "qa-recurring@everyops.test", password: "qa-recurring-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const { blueprint: bp, records } = courtBookingsSample(now);
  // Next Tuesday 7 PM on Court 2 starts the QA series; two Tuesdays later that hour is already taken.
  let tuesday = addDays(todayKey(now), 1);
  while (zonedParts(at(tuesday, "12:00")).weekday !== 2) tuesday = addDays(tuesday, 1);
  const clashDay = addDays(tuesday, 14);
  const template = records.find((r) => r.entityId === "booking" && r.data.status === "paid");
  if (!template) throw new Error("Sample changed.");
  records.push({
    ...template,
    id: "booking_qa_clash",
    data: {
      ...template.data,
      court: "court_2",
      slot: { start: at(clashDay, "19:00"), end: at(clashDay, "20:00") },
    },
  });
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const stamp = now.toISOString();
  const meta = {
    name: "Court House PH",
    summary: "Court bookings",
    createdAt: stamp,
    openedAt: stamp,
    currentVersion: 1,
  };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
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
  console.log(JSON.stringify({ workspace: SLUG, tuesday, clashDay }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
