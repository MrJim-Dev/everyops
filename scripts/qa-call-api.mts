/**
 * A synthetic workspace for checking call_api automations in a browser, against a LOCAL database only: the court
 * bookings sample with a webhook endpoint that accepts automation calls (QA_WEBHOOK_URL, a public test receiver),
 * a save automation that tells it about new players in Slack's {"text": …} shape, and a daily one per court.
 *
 *   QA_WEBHOOK_URL=https://… tsx --conditions=react-server --env-file=.env.local scripts/qa-call-api.mts
 */
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import type { Rule } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-call-api";
const OWNER = { name: "QA Owner", email: "qa-calls@everyops.test", password: "qa-calls-2026" };
const ENDPOINT = "wh_qa_slack";

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const url = process.env.QA_WEBHOOK_URL;
  if (!url?.startsWith("https://")) throw new Error("Set QA_WEBHOOK_URL to a public https test receiver.");
  const now = new Date();
  const ws = courtBookingsSample(now, "Court House PH");
  const rules: Rule[] = [
    {
      id: "tell_slack",
      name: "Tell Slack about new players",
      trigger: { entityId: "player", event: "created" },
      actions: [
        {
          type: "call_api",
          endpointId: ENDPOINT,
          body: '{"text": "New player: {{name}} ({{phone}}). Say hi at the front desk!"}',
        },
      ],
    },
    {
      id: "morning_courts",
      name: "Morning court check",
      trigger: { entityId: "court", event: "schedule", schedule: { every: "day", at: "07:00" } },
      actions: [{ type: "call_api", endpointId: ENDPOINT }],
    },
  ];
  const bp = { ...ws.blueprint, rules: [...ws.blueprint.rules, ...rules] };
  const problems = validateBlueprint(bp);
  if (problems.length) throw new Error(JSON.stringify(problems));
  const records = computeAll(bp, ws.records, now);
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const at = now.toISOString();
  const meta = {
    name: "Court House PH",
    summary: "Court bookings",
    createdAt: at,
    openedAt: at,
    currentVersion: 1,
  };
  await sql`insert into workspace (id, owner_id, doc) values (${SLUG}, ${owner}, ${JSON.stringify(meta)}::jsonb)`.execute(
    db,
  );
  await db
    .transaction()
    .execute((trx) =>
      writeContent(trx, SLUG, { slug: SLUG, ...meta, versions: [bp], records, changes: [], docs: {} }),
    );
  await sql`insert into webhook_endpoint (id, workspace_id, url, description, secret, events, created_by)
    values (${ENDPOINT}, ${SLUG}, ${url}, 'Slack #front-desk (QA receiver)', ${`whsec_${randomBytes(24).toString("base64url")}`},
      ${["automation.call"]}, ${owner})`.execute(db);
  console.log(JSON.stringify({ workspace: SLUG, endpoint: ENDPOINT }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
