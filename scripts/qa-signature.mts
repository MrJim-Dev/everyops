/**
 * A synthetic workspace for checking signature fields in a browser, against a LOCAL database (and a local Cloud
 * Storage stand-in through STORAGE_EMULATOR_HOST) only: kayak rentals whose agreement needs the renter's signature,
 * with a public "Sign the rental agreement" form.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-signature.mts
 */
import { sql } from "kysely";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-signature";
const OWNER = { name: "QA Owner", email: "qa-sign@everyops.test", password: "qa-sign-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

const bp: Blueprint = {
  version: 1,
  workspaceName: "Paddle & Co. Kayak Rentals",
  entities: [
    {
      id: "rental",
      name: "Rental",
      pluralName: "Rentals",
      primaryFieldId: "renter",
      fields: [
        f.text("renter", "Renter", { required: true }),
        f.phone("phone", "Phone"),
        f.select("kayak", "Kayak", [
          ["single", "Single kayak", "accent"],
          ["tandem", "Tandem kayak", "success"],
        ]),
        f.number("hours", "Hours"),
        { id: "signature", name: "Renter signature", type: "signature", required: true },
      ],
    },
  ],
  views: [
    {
      id: "rental_table",
      entityId: "rental",
      name: "Rentals",
      type: "table",
      fieldIds: ["renter", "phone", "kayak", "hours", "signature"],
    },
    {
      id: "sign_agreement",
      entityId: "rental",
      name: "Sign the rental agreement",
      type: "form",
      fieldIds: ["renter", "phone", "kayak", "hours", "signature"],
      public: true,
      intro: "Read the safety rules at the counter, then sign to take your kayak out.",
      submitLabel: "Sign and rent",
    },
  ],
  widgets: [],
  systems: [
    {
      id: "rentals",
      name: "Rentals",
      icon: "key",
      viewIds: ["rental_table", "sign_agreement"],
      widgetIds: [],
    },
  ],
  rules: [],
};

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  if (!process.env.STORAGE_EMULATOR_HOST)
    throw new Error("Set STORAGE_EMULATOR_HOST to a local Cloud Storage stand-in.");
  const problems = validateBlueprint(bp);
  if (problems.length) throw new Error(JSON.stringify(problems));
  const now = new Date();
  const at = now.toISOString();
  const records: DataRecord[] = computeAll(bp, [], now);
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const meta = {
    name: bp.workspaceName,
    summary: "Kayak rentals",
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
  console.log(JSON.stringify({ workspace: SLUG }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
