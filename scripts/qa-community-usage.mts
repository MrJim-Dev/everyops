/**
 * Synthetic Community usage for checking counts and marks in a browser, against a LOCAL database only. Every case
 * the numbers must tell apart, with the answer it should give:
 * - court-bookings: 6 copies (4 changed this month) and 12 starter workspaces (8 marked, 4 older ones made when
 *   their account was seeded) → 6 uses, 4 active; starters don't count.
 * - canteen-pos: 3 copies, 2 active → 3 uses, 2 active.
 * - content-calendar: 3 copies made this week, 1 active → Trending.
 * - small-business-finances: 2 copies, last changed in August → 2 uses, none active.
 * - employee-leave: 1 workspace setup built from it (via "setup"), active → 1 use, 1 active.
 * - a system someone published 3 days ago → New.
 * - court-bookings' own source workspace and a canteen-pos copy in the demo account → not counted.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-community-usage.mts
 */
import { sql } from "kysely";
import { auth } from "@/server/auth";
import { db } from "@/server/db";

const OWNER = { name: "QA Owner", email: "qa-usage@everyops.test", password: "qa-usage-2026" };
const day = 86_400_000;
const now = Date.now();
const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();

async function user(email: string, name: string) {
  const found = await sql<{ id: string }>`select id from "user" where email = ${email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: { name, email, password: OWNER.password } })).user.id;
}

async function workspace(
  id: string,
  owner: string,
  systemId: string,
  createdDaysAgo: number,
  via: string | null,
  lastChangeDaysAgo: number | null,
) {
  const source = via ? { systemId, version: "1.2", via } : { systemId, version: "1.2" };
  const doc = {
    name: id,
    summary: "",
    createdAt: at(createdDaysAgo),
    openedAt: at(0),
    currentVersion: 1,
    source,
  };
  await sql`insert into workspace (id, owner_id, doc, created_at) values (${id}, ${owner}, ${JSON.stringify(doc)}::jsonb, ${at(createdDaysAgo)})`.execute(
    db,
  );
  // The sample records a workspace starts with are written when it's made.
  await sql`insert into workspace_record (workspace_id, id, entity_id, data, created_at, updated_at, changed_at) values (${id}, 'sample', 'thing', '{}'::jsonb, ${at(createdDaysAgo)}, ${at(createdDaysAgo)}, ${at(createdDaysAgo)})`.execute(
    db,
  );
  if (lastChangeDaysAgo !== null)
    await sql`insert into workspace_record (workspace_id, id, entity_id, data, created_at, updated_at, changed_at) values (${id}, 'real', 'thing', '{}'::jsonb, ${at(lastChangeDaysAgo)}, ${at(lastChangeDaysAgo)}, ${at(lastChangeDaysAgo)})`.execute(
      db,
    );
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  await sql`delete from workspace where id like 'qa-usage-%'`.execute(db);
  await sql`delete from published_system where id = 'salon-appointments-qa'`.execute(db);
  await sql`update published_system set published_at = ${at(27)} where is_official`.execute(db);
  const owner = await user(OWNER.email, OWNER.name);

  for (let i = 0; i < 8; i++) {
    const starter = await user(`qa-usage-starter${i}@everyops.test`, `Starter ${i}`);
    await workspace(`qa-usage-starter-${i}`, starter, "court-bookings", 20, "starter", 2);
  }
  for (let i = 0; i < 4; i++) {
    const old = await user(`qa-usage-old${i}@everyops.test`, `Older starter ${i}`);
    await sql`insert into account_seed (user_id, seeded_at) values (${old}, ${at(40)}) on conflict (user_id) do update set seeded_at = excluded.seeded_at`.execute(
      db,
    );
    await workspace(`qa-usage-oldstarter-${i}`, old, "court-bookings", 40, null, 3);
  }
  for (let i = 0; i < 6; i++)
    await workspace(
      `qa-usage-court-${i}`,
      owner,
      "court-bookings",
      45,
      i % 3 === 0 ? null : "copy",
      i < 4 ? 4 : 50,
    );
  for (let i = 0; i < 3; i++)
    await workspace(`qa-usage-pos-${i}`, owner, "canteen-pos", 60, "copy", i < 2 ? 1 : null);
  for (let i = 0; i < 3; i++)
    await workspace(`qa-usage-content-${i}`, owner, "content-calendar", 4 + i, "copy", i === 0 ? 0.5 : null);
  for (let i = 0; i < 2; i++)
    await workspace(`qa-usage-finance-${i}`, owner, "small-business-finances", 90, "copy", 70);
  await workspace("qa-usage-leave-0", owner, "employee-leave", 10, "setup", 1);
  // Never uses: the workspace an official system was built and published from, and copies in the demo account
  // (production had one of each per template, all reading 1 use / 1 active).
  await workspace("qa-usage-source-court", owner, "court-bookings", 15, null, 1);
  await sql`update published_system set source_workspace_id = 'qa-usage-source-court' where id = 'court-bookings'`.execute(
    db,
  );
  const demo = await user("james@everyops.app", "James Ocampo");
  await workspace("qa-usage-demo-pos", demo, "canteen-pos", 15, "copy", 1);

  const leave = await sql<{
    doc: Record<string, unknown>;
  }>`select doc from published_system where id = 'employee-leave'`.execute(db);
  const doc = {
    ...leave.rows[0].doc,
    name: "Salon appointments",
    summary: "Stylists, services and appointments for a salon.",
    author: "QA Owner",
  };
  await sql`insert into published_system (id, author_id, doc, published_at) values ('salon-appointments-qa', ${owner}, ${JSON.stringify(doc)}::jsonb, ${at(3)})`.execute(
    db,
  );
  console.log(JSON.stringify({ owner: OWNER.email }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
