import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { sql } from "kysely";
import { auth } from "@/server/auth";
import { db } from "@/server/db";

/** Better Auth's tables first, then the app's SQL migrations in order. Safe to run repeatedly. */
async function main() {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length || toBeAdded.length) {
    for (const t of toBeCreated) console.log(`auth: create table ${t.table}`);
    for (const t of toBeAdded) console.log(`auth: add columns to ${t.table}`);
    await runMigrations();
  } else console.log("auth: up to date");

  await sql`create table if not exists app_migration (name text primary key, applied_at timestamptz not null default now())`.execute(
    db,
  );
  const dir = path.join(process.cwd(), "src/server/migrations");
  const applied = new Set(
    (await sql<{ name: string }>`select name from app_migration`.execute(db)).rows.map((r) => r.name),
  );
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (applied.has(file)) continue;
    await db.transaction().execute(async (trx) => {
      await sql.raw(readFileSync(path.join(dir, file), "utf8")).execute(trx);
      await sql`insert into app_migration (name) values (${file})`.execute(trx);
    });
    console.log(`app: applied ${file}`);
  }
  console.log("Database is up to date.");
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
