/**
 * Sets up a LOCAL database for checking the AI use log in a browser: an owner and a staff member sharing the court
 * bookings sample. Their Gemini calls (Ask EveryOps, the checkup, setup) then show in Settings → AI use and on the
 * Account page.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-ai-usage.mts                # create or reset
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-ai-usage.mts --script-call  # one tiny Gemini call
 *
 * --script-call checks that a script's calls are logged too (as "script", owned by no one). Refuses to run unless
 * DATABASE_URL points at localhost.
 */
import { sql } from "kysely";
import { z } from "zod";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { generateJson } from "@/server/ai/gemini";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-ai-usage";
const OWNER = { name: "Maria Santos", email: "qa-ai-owner@everyops.test", password: "qa-ai-usage-2026" };
const STAFF = { name: "Paolo Reyes", email: "qa-ai-staff@everyops.test", password: "qa-ai-usage-2026" };

async function userId(person: typeof OWNER): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${person.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: person })).user.id;
}

async function scriptCall() {
  const result = await generateJson(z.object({ ok: z.boolean() }), {
    system: "Answer in JSON.",
    prompt: 'Reply with {"ok": true}.',
    task: "qa-script",
    thinking: "LOW",
    maxOutputTokens: 50,
  });
  // The log write isn't awaited by generateJson; give it a moment before closing the pool.
  await new Promise((r) => setTimeout(r, 1000));
  const { rows } = await sql<{ feature: string; origin: string; user_id: string | null; outcome: string }>`
    select feature, origin, user_id, outcome from ai_call where task = 'qa-script' order by at desc limit 1`.execute(
    db,
  );
  console.log(JSON.stringify({ answered: result.ok, logged: rows[0] ?? null }));
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  if (process.argv.includes("--script-call")) return scriptCall();
  const now = new Date();
  const name = "Court House PH";
  const { blueprint, records } = courtBookingsSample(now, name);
  const [owner, staff] = [await userId(OWNER), await userId(STAFF)];
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Bookings and payments", createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await sql`insert into workspace_member (workspace_id, user_id, role) values (${SLUG}, ${staff}, 'staff')`.execute(
    db,
  );
  await db.transaction().execute((trx) =>
    writeContent(trx, SLUG, {
      slug: SLUG,
      ...meta,
      versions: [blueprint],
      records: computeAll(blueprint, records, now),
      changes: [],
      docs: {},
    }),
  );
  console.log(
    JSON.stringify({ workspace: SLUG, owner: OWNER.email, staff: STAFF.email, password: OWNER.password }),
  );
}

main()
  .then(() => db.destroy())
  .catch(async (error) => {
    console.error(error);
    await db.destroy();
    process.exit(1);
  });
