import { getMigrations } from "better-auth/db/migration";
import { auth } from "@/server/auth";
import { db } from "@/server/db";

/** Creates or updates Better Auth's tables. Safe to run repeatedly. */
async function main() {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (!toBeCreated.length && !toBeAdded.length) {
    console.log("Auth schema is up to date.");
  } else {
    for (const t of toBeCreated) console.log(`create table ${t.table}`);
    for (const t of toBeAdded) console.log(`add columns to ${t.table}: ${Object.keys(t.fields).join(", ")}`);
    await runMigrations();
    console.log("Auth schema migrated.");
  }
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
