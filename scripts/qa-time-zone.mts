/**
 * A synthetic workspace for checking the workspace time zone in a browser, against a LOCAL database only: the court
 * bookings sample (Manila to start) with its booking form public.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-time-zone.mts
 */
import { sql } from "kysely";
import type { Blueprint } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-time-zone";
const OWNER = { name: "QA Owner", email: "qa-tz@everyops.test", password: "qa-tz-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const ws = courtBookingsSample(now, "Shibuya Courts");
  const bp: Blueprint = {
    ...ws.blueprint,
    views: ws.blueprint.views.map((v) => (v.type === "form" ? { ...v, public: true } : v)),
  };
  const records = computeAll(bp, ws.records, now);
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = {
    name: "Shibuya Courts",
    summary: "Court bookings",
    createdAt: at,
    openedAt: at,
    currentVersion: 1,
  };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [bp], records, changes: [], docs: {} }),
    );
  const first = records
    .filter((r) => r.entityId === "booking")
    .sort((a, b) =>
      String((a.data.slot as { start?: string })?.start).localeCompare(
        String((b.data.slot as { start?: string })?.start),
      ),
    )[0];
  console.log(
    JSON.stringify({
      workspace: SLUG,
      form: bp.views.find((v) => v.type === "form")?.id,
      firstBooking: first?.data.slot,
    }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
