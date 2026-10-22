/**
 * A synthetic workspace for checking notifications in a browser, against a LOCAL database only: the court bookings
 * sample with its booking form public and an email on players, an owner (Ana Cruz) and a staff member (Ben Lim).
 * The automation is added in the browser by asking EveryOps.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-notifications.mts
 */
import { sql } from "kysely";
import type { Blueprint } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-notifications";
const OWNER = { name: "Ana Cruz", email: "qa-notify@everyops.test", password: "qa-notify-2026" };
const STAFF = { name: "Ben Lim", email: "qa-notify-staff@everyops.test", password: "qa-notify-2026" };

async function userId(u: typeof OWNER): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${u.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: u })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Court House PH";
  const sample = courtBookingsSample(now, name);
  const player = sample.blueprint.entities.find((e) => e.id === "player");
  const booking = sample.blueprint.entities.find((e) => e.id === "booking");
  if (!player || !booking) throw new Error("Sample changed.");
  player.fields.push(f.email("email", "Email"));
  // Visitors book as themselves: their name and email, with the player link optional (staff fill it in).
  booking.fields.push(f.text("guest_name", "Your name"), f.email("guest_email", "Email"));
  const link = booking.fields.find((x) => x.id === "player");
  if (link) link.required = false;
  const pn = booking.fields.find((x) => x.id === "player_name");
  if (pn?.formula) pn.formula.expr = "player.name ? player.name : guest_name";
  for (const r of sample.records.filter((r) => r.entityId === "player"))
    r.data.email = `${String(r.data.name)
      .toLowerCase()
      .replace(/[^a-z]+/g, ".")}@players.test`;
  const bp: Blueprint = {
    ...sample.blueprint,
    views: sample.blueprint.views.map((v) =>
      v.type === "form"
        ? {
            ...v,
            public: true,
            fieldIds: ["court", "slot", "guest_name", "guest_email", "status"],
            steps: [
              { id: "when", title: "Court and time", fieldIds: ["court", "slot"] },
              { id: "who", title: "Your details", fieldIds: ["guest_name", "guest_email"] },
              { id: "pay", title: "Payment", fieldIds: ["status"] },
            ],
          }
        : v,
    ),
  };
  const [owner, staff] = [await userId(OWNER), await userId(STAFF)];
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Court bookings", createdAt: at, openedAt: at, currentVersion: 1 };
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
      versions: [bp],
      records: computeAll(bp, sample.records, now),
      changes: [],
      docs: {},
    }),
  );
  console.log(JSON.stringify({ workspace: SLUG, owner: OWNER.email, staff: STAFF.email }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
