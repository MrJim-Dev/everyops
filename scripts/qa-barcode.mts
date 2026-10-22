/**
 * A synthetic workspace for checking barcode scanning in a browser, against a LOCAL database only: the canteen POS
 * sample with a Barcode on each product (the first one 4800016644405, the EAN-13 the QA camera shows).
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-barcode.mts
 */
import { sql } from "kysely";
import { posSample } from "@/lib/catalog/canteen-pos";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-barcode";
const OWNER = { name: "Tita Nena", email: "qa-barcode@everyops.test", password: "qa-barcode-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Tita Nena's Canteen";
  const { blueprint: bp, records } = posSample(now, name);
  const product = bp.entities.find((e) => e.id === "product");
  if (!product) throw new Error("Sample changed.");
  product.fields.splice(1, 0, f.text("barcode", "Barcode"));
  const products = records.filter((r) => r.entityId === "product");
  products.forEach((r, i) => {
    r.data.barcode = i === 0 ? "4800016644405" : String(4800000000000 + (i + 1) * 1111);
  });
  for (const v of bp.views)
    if (v.type === "table" && v.entityId === "product" && !v.fieldIds.includes("barcode"))
      v.fieldIds = [v.fieldIds[0], "barcode", ...v.fieldIds.slice(1)];
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Orders and products", createdAt: at, openedAt: at, currentVersion: 1 };
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
  const view = bp.views.find((v) => v.type === "table" && v.entityId === "product");
  const system = bp.systems.find((s) => s.viewIds.includes(view?.id ?? ""));
  console.log(
    JSON.stringify({ workspace: SLUG, page: system?.id, view: view?.id, first: products[0]?.data.name }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
