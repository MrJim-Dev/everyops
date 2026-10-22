/**
 * Two synthetic workspaces for checking the workspace currency in a browser, against a LOCAL database only: the
 * canteen POS sample in pesos (to switch from Settings) and the court bookings sample in Singapore dollars with
 * its booking form public (to see a public page).
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-currency.mts
 */
import { sql } from "kysely";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { posSample } from "@/lib/catalog/canteen-pos";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const OWNER = { name: "QA Owner", email: "qa-currency@everyops.test", password: "qa-currency-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function save(
  slug: string,
  name: string,
  summary: string,
  bp: Blueprint,
  records: DataRecord[],
  owner: string,
) {
  await sql`delete from workspace where id = ${slug}`.execute(db);
  const at = new Date().toISOString();
  const meta = { name, summary, createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${slug}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, slug, { slug, ...meta, versions: [bp], records, changes: [], docs: {} }),
    );
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const owner = await ownerId();
  const pos = posSample(now, "Tita Nena's Canteen");
  await save(
    "qa-currency",
    "Tita Nena's Canteen",
    "Orders and products",
    pos.blueprint,
    computeAll(pos.blueprint, pos.records, now),
    owner,
  );
  const court = courtBookingsSample(now, "Marina Courts");
  const bp: Blueprint = {
    ...court.blueprint,
    currency: "SGD",
    views: court.blueprint.views.map((v) => (v.type === "form" ? { ...v, public: true } : v)),
  };
  await save(
    "qa-currency-sg",
    "Marina Courts",
    "Court bookings in Singapore",
    bp,
    computeAll(bp, court.records, now),
    owner,
  );
  console.log(
    JSON.stringify({
      pos: "qa-currency",
      site: "qa-currency-sg",
      form: bp.views.find((v) => v.type === "form")?.id,
    }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
