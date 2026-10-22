/**
 * Builds a synthetic workspace for checking print templates in a browser, against a LOCAL database only: the
 * canteen POS sample with a "Sales invoice" template on orders (details, line items, totals).
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-print-templates.mts
 */
import { sql } from "kysely";
import { posSample } from "@/lib/catalog/canteen-pos";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-print-templates";
const OWNER = { name: "QA Owner", email: "qa-print@everyops.test", password: "qa-print-2026" };

const INVOICE = [
  "# {{business}}",
  "Purok 3, Lahug, Cebu City · 0917 555 0142",
  "## Sales invoice {{code}}",
  "**Date:** {{placed_at}}  ",
  "**Payment:** {{payment}}  ",
  "**Status:** {{status}}",
  "{{lines:order_line}}",
  "**Items:** {{items}}  ",
  "**Total due:** {{total}}  ",
  "**Cash received:** {{cash_received}}  ",
  "**Change:** {{change_due}}",
  "---",
  "Thank you for eating with us! This invoice was printed on {{today}}.",
].join("\n\n");

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
  const { blueprint: bp, records: sample } = posSample(now, name);
  bp.printTemplates = [
    { id: "print_invoice", entityId: "order", name: "Sales invoice", body: INVOICE, paper: "a4" },
  ];
  const records = computeAll(bp, sample, now);
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = {
    name,
    summary: "Orders, products and sales",
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
  const order = records.find((r) => r.entityId === "order" && records.some((l) => l.data.order === r.id));
  console.log(JSON.stringify({ workspace: SLUG, order: order?.data.code, total: order?.data.total }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
