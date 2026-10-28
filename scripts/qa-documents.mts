/**
 * A synthetic workspace for checking Documents in a browser, against a LOCAL database and a local Cloud Storage
 * stand-in only (scripts/storage-stand-in.mjs through STORAGE_EMULATOR_HOST): the court bookings sample as
 * "Dink & Drop Pickleball" and one court photo stored the way files were before Documents kept a list, for
 * scripts/backfill-documents.mts to find.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-documents.mts
 */
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { uploadsBucket } from "@/server/storage";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-documents";
const OWNER = { name: "Mia Lopez", email: "qa-docs@everyops.test", password: "qa-docs-2026" };

// A 1×1 green PNG, the smallest real picture.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  if (!process.env.STORAGE_EMULATOR_HOST)
    throw new Error("Set STORAGE_EMULATOR_HOST to a local Cloud Storage stand-in.");
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  const owner = found.rows[0]?.id ?? (await auth.api.signUpEmail({ body: OWNER })).user.id;
  await sql`update "user" set "emailVerified" = true where id = ${owner}`.execute(db);
  const now = new Date();
  const name = "Dink & Drop Pickleball";
  const { blueprint, records } = courtBookingsSample(now, name);
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
  // A court photo uploaded before Documents kept a list: in storage, on the court, but not in file_upload.
  const photo = `${SLUG}/${randomUUID()}.png`;
  await uploadsBucket().file(photo).save(PNG, { contentType: "image/png", resumable: false });
  const court = records.find((r) => r.entityId === "court");
  const picture = blueprint.entities.find((e) => e.id === "court")?.fields.find((f) => f.type === "image");
  if (court && picture) court.data[picture.id] = `/api/files/${photo}`;
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [blueprint], records, changes: [], docs: {} }),
    );
  console.log(
    JSON.stringify({ workspace: SLUG, owner: OWNER.email, legacyPhoto: photo, onCourt: !!picture }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
