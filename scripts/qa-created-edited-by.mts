/**
 * Builds a synthetic workspace for checking Created by / Last edited by in a browser, against a LOCAL database only:
 * the court bookings sample with both fields on players, an owner (Ana Cruz) and a staff member (Ben Lim), a public
 * "Join the club" form, and a daily automation that marks new players as welcomed. The sample players are stamped
 * as added by Ana.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-created-edited-by.mts
 */
import { sql } from "kysely";
import type { Rule } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-created-edited-by";
const OWNER = { name: "Ana Cruz", email: "qa-actors@everyops.test", password: "qa-actors-2026" };
const STAFF = { name: "Ben Lim", email: "qa-actors-staff@everyops.test", password: "qa-actors-2026" };

async function userId(u: typeof OWNER): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${u.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: u })).user.id;
}

const WELCOME: Rule = {
  id: "welcome_new_players",
  name: "Welcome new players",
  trigger: { entityId: "player", event: "schedule", schedule: { every: "day", at: "09:00" } },
  when: 'welcomed != true && name == "Dana Uy"',
  actions: [{ type: "set_field", target: { kind: "self" }, fieldId: "welcomed", value: "true" }],
} as Rule;

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Court House PH";
  const { blueprint: bp, records: sample } = courtBookingsSample(now, name);
  const player = bp.entities.find((e) => e.id === "player");
  if (!player) throw new Error("Sample changed.");
  player.fields.push(
    f.checkbox("welcomed", "Welcomed"),
    { id: "created_by", name: "Created by", type: "created_by" },
    { id: "edited_by", name: "Last edited by", type: "edited_by" },
  );
  const table = bp.views.find((v) => v.id === "players_table");
  if (table?.type === "table") {
    table.fieldIds = ["name", "phone", "welcomed", "created_by", "edited_by"];
    table.sort = [{ fieldId: "name", dir: "asc" }];
  }
  bp.views.push({
    id: "join",
    entityId: "player",
    name: "Join the club",
    type: "form",
    fieldIds: ["name", "phone"],
    public: true,
    intro: "Leave your details and we'll send you open-play schedules.",
  });
  bp.systems.find((s) => s.viewIds.includes("players_table"))?.viewIds.push("join");
  bp.rules = [...bp.rules, WELCOME];
  const records = computeAll(bp, sample, now);

  const [owner, staff] = [await userId(OWNER), await userId(STAFF)];
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Bookings and players", createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await sql`insert into workspace_member (workspace_id, user_id, role) values (${SLUG}, ${staff}, 'staff')`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [bp], records, changes: [], docs: {} }),
    );
  const ana = JSON.stringify({ type: "person", id: owner, name: OWNER.name });
  await sql`update workspace_record set created_by = ${ana}::jsonb, updated_by = ${ana}::jsonb
    where workspace_id = ${SLUG}`.execute(db);
  console.log(JSON.stringify({ workspace: SLUG, owner: OWNER.email, staff: STAFF.email }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
