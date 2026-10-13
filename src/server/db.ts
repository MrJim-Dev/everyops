import { readFileSync } from "node:fs";
import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

/**
 * App tables are added here as they move off the browser. Better Auth owns
 * "user", "session", "account" and "verification" through the same connection.
 */
// biome-ignore lint/complexity/noBannedTypes: no app tables yet
export type Database = {};

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL is not set. Run `pnpm env:pull` to create .env.local.");
  // RDS requires TLS. Verify the server against the AWS RDS CA bundle unless explicitly disabled (local Postgres).
  const ssl =
    process.env.DATABASE_SSL === "disable"
      ? false
      : {
          rejectUnauthorized: true,
          ca: readFileSync(
            process.env.DATABASE_CA_PATH ?? path.join(process.cwd(), "certs/rds-global-bundle.pem"),
            "utf8",
          ),
        };
  return new Pool({
    connectionString,
    ssl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

const globalForDb = globalThis as { everyopsDb?: Kysely<Database> };

/** One Kysely instance per server process. The pool opens lazily, so builds don't need a database. */
export const db: Kysely<Database> =
  globalForDb.everyopsDb ??
  new Kysely<Database>({ dialect: new PostgresDialect({ pool: async () => createPool() }) });

if (process.env.NODE_ENV !== "production") globalForDb.everyopsDb = db;
