/**
 * Builds a synthetic workspace for checking Pages in a browser, against a LOCAL database only: the court bookings
 * sample as "Dink & Drop Pickleball", with its standard home page (under Pages) and a public booking form. Pages
 * themselves are then made in the browser through Ask EveryOps, the way an owner makes them.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-pages.mts
 */
import { sql } from "kysely";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { standardLanding } from "@/lib/public/site-template";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-pages";
const OWNER = { name: "QA Owner", email: "qa-pages@everyops.test", password: "qa-pages-2026" };

async function ownerId() {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Dink & Drop Pickleball";
  const { blueprint: bp, records } = courtBookingsSample(now, name);
  const form = bp.views.find((v) => v.type === "form" && v.entityId === "booking");
  if (form?.type !== "form") throw new Error("No booking form.");
  form.public = true;
  bp.systems.push({ id: "home", name: "Home", icon: "house", viewIds: ["site_home"], widgetIds: [] });
  bp.views.push(
    standardLanding(
      bp,
      name,
      { contact: { phone: "0917 555 0123", address: "Mandaue City, Cebu", hours: "6 AM to 11 PM" } },
      "site_home",
    ),
  );

  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = {
    name,
    summary: "Courts, bookings and players",
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
  console.log(
    JSON.stringify({ workspace: SLUG, systems: bp.systems.map((s) => s.name), records: records.length }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
