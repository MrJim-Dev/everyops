/**
 * Builds a synthetic workspace for checking email, phone, link and file fields and filtered rollups in a browser,
 * against a LOCAL database only: the court bookings sample with typed player contact details, a waiver file field,
 * a paid-only rollup, court websites and a public "Join the club" form.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-field-types.mts
 */
import { sql } from "kysely";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-field-types";
const OWNER = { name: "QA Owner", email: "qa-fields@everyops.test", password: "qa-fields-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Court House PH";
  const { blueprint: bp, records: sample } = courtBookingsSample(now, name);
  const player = bp.entities.find((e) => e.id === "player");
  const court = bp.entities.find((e) => e.id === "court");
  if (!player || !court) throw new Error("Sample changed.");
  const phone = player.fields.find((x) => x.id === "phone");
  if (phone) phone.type = "phone";
  const spent = player.fields.find((x) => x.id === "spent");
  player.fields.push(f.email("email", "Email"), f.file("waiver", "Signed waiver"));
  if (spent?.rollup)
    player.fields.push(f.rollup("paid", "Paid so far", { ...spent.rollup, filter: 'status == "paid"' }));
  court.fields.push(f.url("website", "Court page"));
  for (const r of sample.filter((r) => r.entityId === "player"))
    r.data.email = `${String(r.data.name)
      .toLowerCase()
      .replace(/[^a-z]+/g, ".")}@players.test`;
  for (const r of sample.filter((r) => r.entityId === "court"))
    r.data.website = `courthouse.ph/courts/${String(r.data.name).toLowerCase().replace(/\s+/g, "-")}`;
  const table = bp.views.find((v) => v.entityId === "player" && v.type === "table");
  if (table?.type === "table") table.fieldIds = ["name", "email", "phone", "waiver", "spent", "paid"];
  const courts = bp.views.find((v) => v.entityId === "court" && v.type === "table");
  if (courts?.type === "table")
    courts.fieldIds = [...courts.fieldIds.filter((x) => x !== "website"), "website"];
  bp.views.push({
    id: "join",
    entityId: "player",
    name: "Join the club",
    type: "form",
    fieldIds: ["name", "email", "phone", "waiver"],
    public: true,
    intro: "Leave your details and we'll send you open-play schedules.",
  });
  bp.systems.find((s) => s.viewIds.includes(table?.id ?? ""))?.viewIds.push("join");
  const records = computeAll(bp, sample, now);

  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Bookings and players", createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [bp], records, changes: [], docs: {} }),
    );
  const p = records.find((r) => r.entityId === "player");
  console.log(
    JSON.stringify({ workspace: SLUG, player: p?.data.name, spent: p?.data.spent, paid: p?.data.paid }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
