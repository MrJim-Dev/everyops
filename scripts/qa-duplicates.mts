/**
 * A synthetic workspace for checking duplicate warnings and merging in a browser, against a LOCAL database
 * only: the court booking sample, plus Kevin Sy added a second time as "Kevin S." (his phone with +63) with 3 bookings.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-duplicates.mts
 */
import { sql } from "kysely";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-duplicates";
const OWNER = { name: "Ana Cruz", email: "qa-duplicates@everyops.test", password: "qa-duplicates-2026" };

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
  const kevin = records.find((r) => r.entityId === "player" && r.data.name === "Kevin Sy");
  const his = records.filter((r) => r.entityId === "booking" && r.data.player === kevin?.id).slice(0, 3);
  if (!kevin || his.length < 3) throw new Error("Sample changed.");
  const twin = {
    ...kevin,
    id: "player_qa_twin",
    data: { name: "Kevin S.", phone: `+63 ${String(kevin.data.phone).slice(1)}` },
  };
  records.push(twin);
  for (const b of his) b.data.player = twin.id;
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
  console.log(JSON.stringify({ workspace: SLUG, kevin: kevin.id, phone: kevin.data.phone, twin: twin.data }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
