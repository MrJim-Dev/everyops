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
  // Cloud SQL is reached through an encrypted channel: the Cloud Run socket (/cloudsql/…) in production and
  // the Cloud SQL Auth Proxy on localhost in development, so the driver itself needs no TLS. Set
  // DATABASE_CA_PATH only when connecting straight to a TLS server (it is then verified against that CA).
  const caPath = process.env.DATABASE_CA_PATH;
  const ssl = caPath ? { rejectUnauthorized: true, ca: readFileSync(path.resolve(caPath), "utf8") } : false;
  const pool = new Pool({
    connectionString,
    ssl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Cloud SQL now and then closes an idle connection. Without a listener, pg raises that as an uncaught exception
  // and takes the whole server (and every request in flight) down; the pool drops the client and opens a new one.
  pool.on("error", (error) =>
    console.warn(JSON.stringify({ event: "db_idle_client_error", message: error.message })),
  );
  return pool;
}

const globalForDb = globalThis as { everyopsDb?: Kysely<Database> };

/** One Kysely instance per server process. The pool opens lazily, so builds don't need a database. */
export const db: Kysely<Database> =
  globalForDb.everyopsDb ??
  new Kysely<Database>({ dialect: new PostgresDialect({ pool: async () => createPool() }) });

if (process.env.NODE_ENV !== "production") globalForDb.everyopsDb = db;
