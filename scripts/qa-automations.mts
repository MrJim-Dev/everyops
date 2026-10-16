/**
 * Builds a synthetic workspace for checking automations in a browser, against a LOCAL database only: the court
 * bookings sample with player emails, a Follow-ups record type and four automations (a day-before reminder email,
 * a daily unpaid chase, a thank-you email when a booking is paid, and a follow-up when one is cancelled).
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-automations.mts          # create or reset
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import { sql } from "kysely";
import type { Rule } from "@/lib/blueprint/types";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { addDays, dateKey, todayKey } from "@/lib/time";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-automations";
const OWNER = { name: "QA Owner", email: "qa-automations@everyops.test", password: "qa-automations-2026" };

const RULES: Rule[] = [
  {
    id: "reminder_day_before",
    name: "Reminder the day before",
    trigger: { entityId: "booking", event: "date_reached", fieldId: "slot", offsetDays: -1, at: "18:00" },
    when: 'status != "cancelled"',
    actions: [
      {
        type: "send_email",
        to: "{{player.email}}",
        subject: "See you tomorrow at {{court.name}}",
        body: "Hi {{player.name}},\n\nThis is a reminder of your booking at {{court.name}} tomorrow.\n\nCourt House PH",
      },
    ],
  },
  {
    id: "chase_unpaid",
    name: "Chase unpaid bookings",
    trigger: { entityId: "booking", event: "schedule", schedule: { every: "day", at: "09:00" } },
    when: 'status == "unpaid" && player.name == "Paolo Reyes"',
    actions: [
      {
        type: "send_email",
        to: "frontdesk@courthouse.test",
        subject: "Unpaid: {{player.name}} on {{court.name}}",
        body: "{{player.name}} still owes {{amount}} for a booking on {{court.name}}.",
      },
    ],
  },
  {
    id: "thanks_when_paid",
    name: "Thank-you email when paid",
    trigger: { entityId: "booking", event: "status_changed", fieldId: "status", to: "paid" },
    actions: [
      {
        type: "send_email",
        to: "{{player.email}}",
        subject: "Thanks for your payment, {{player.name}}",
        body: "We received {{amount}} for {{court.name}}. See you on court!",
      },
    ],
  },
  {
    id: "follow_up_cancel",
    name: "Follow up on cancellations",
    trigger: { entityId: "booking", event: "status_changed", fieldId: "status", to: "cancelled" },
    actions: [
      {
        type: "create_record",
        entityId: "follow_up",
        values: { note: '"Call " + player.name + " to rebook"' },
      },
      { type: "notify", message: "Added a follow-up to call {{player.name}}" },
    ],
  },
];

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  const made = await auth.api.signUpEmail({ body: OWNER });
  return made.user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const now = new Date();
  const name = "Court House PH";
  const { blueprint: bp, records: sample } = courtBookingsSample(now, name);
  let records = sample;
  const player = bp.entities.find((e) => e.id === "player");
  if (!player) throw new Error("No players in the sample.");
  player.fields.push(f.text("email", "Email"));
  // One named player has unpaid bookings to chase (renamed before emails are made from names).
  const paolo = records.find((r) => r.entityId === "player");
  if (paolo) paolo.data.name = "Paolo Reyes";
  for (const p of records.filter((r) => r.entityId === "player"))
    p.data.email = `${String(p.data.name)
      .toLowerCase()
      .replace(/[^a-z]+/g, ".")}@players.test`;
  bp.entities.push({
    id: "follow_up",
    name: "Follow-up",
    pluralName: "Follow-ups",
    primaryFieldId: "note",
    fields: [f.text("note", "Note"), f.relation("booking", "Booking", "booking")],
  });
  bp.views.push({
    id: "follow_ups",
    entityId: "follow_up",
    name: "Follow-ups",
    type: "table",
    fieldIds: ["note", "booking"],
  });
  bp.systems.push({
    id: "follow_ups_page",
    name: "Follow-ups",
    icon: "users",
    viewIds: ["follow_ups"],
    widgetIds: [],
  });
  bp.rules = RULES;

  // Tomorrow's bookings get a reminder today.
  const tomorrow = addDays(todayKey(now), 1);
  const due = records.filter(
    (r) => r.entityId === "booking" && dateKey((r.data.slot as { start: string }).start) === tomorrow,
  );
  const firstUnpaid = records.find((r) => r.entityId === "booking" && r.data.status === "unpaid");
  if (firstUnpaid && paolo) firstUnpaid.data.player = paolo.id;
  records = computeAll(bp, records, now);

  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = { name, summary: "Bookings and payments", createdAt: at, openedAt: at, currentVersion: 1 };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [bp], records, changes: [], docs: {} }),
    );
  console.log(
    JSON.stringify({
      workspace: SLUG,
      owner: OWNER.email,
      bookingsTomorrow: due.length,
      rules: RULES.length,
    }),
  );
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
