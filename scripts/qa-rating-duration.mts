/**
 * A synthetic workspace for checking rating and duration fields in a browser, against a LOCAL database only: an
 * aircon service business whose jobs have a star rating and time spent (plus visits that add up to a total), a
 * dashboard with the average rating and hours worked, and a public "Rate our service" form.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/qa-rating-duration.mts
 */
import { sql } from "kysely";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { f } from "@/lib/catalog/define";
import { computeAll } from "@/lib/engine/compute";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { writeContent } from "@/server/workspace-data";

const SLUG = "qa-rating-duration";
const OWNER = { name: "QA Owner", email: "qa-fields2@everyops.test", password: "qa-fields2-2026" };

async function ownerId(): Promise<string> {
  const found = await sql<{ id: string }>`select id from "user" where email = ${OWNER.email}`.execute(db);
  if (found.rows[0]) return found.rows[0].id;
  return (await auth.api.signUpEmail({ body: OWNER })).user.id;
}

const bp: Blueprint = {
  version: 1,
  workspaceName: "CoolBreeze Aircon Services",
  entities: [
    {
      id: "job",
      name: "Job",
      pluralName: "Jobs",
      primaryFieldId: "title",
      fields: [
        f.text("title", "Job", { required: true }),
        f.text("customer", "Customer"),
        f.select("technician", "Technician", [
          ["rico", "Rico", "accent"],
          ["joy", "Joy", "success"],
          ["ben", "Ben", "neutral"],
        ]),
        f.status("status", "Status", [
          ["scheduled", "Scheduled", "neutral"],
          ["done", "Done", "success"],
        ]),
        f.date("done_on", "Date"),
        f.duration("time_spent", "Time spent"),
        f.rating("rating", "Customer rating"),
        f.longText("notes", "Notes"),
      ],
    },
    {
      id: "feedback",
      name: "Feedback",
      pluralName: "Feedback",
      primaryFieldId: "name",
      fields: [
        f.text("name", "Your name", { required: true }),
        f.rating("stars", "How did we do?", { required: true }),
        f.duration("wait", "How long did you wait for us?"),
        f.longText("comments", "Comments"),
      ],
    },
  ],
  views: [
    {
      id: "job_table",
      entityId: "job",
      name: "All jobs",
      type: "table",
      fieldIds: ["title", "customer", "technician", "status", "done_on", "time_spent", "rating"],
      totals: true,
      sort: [{ fieldId: "done_on", dir: "desc" }],
    },
    {
      id: "feedback_table",
      entityId: "feedback",
      name: "Feedback",
      type: "table",
      fieldIds: ["name", "stars", "wait", "comments"],
    },
    {
      id: "rate_us",
      entityId: "feedback",
      name: "Rate our service",
      type: "form",
      fieldIds: ["name", "stars", "wait", "comments"],
      public: true,
      intro: "Thanks for choosing CoolBreeze. Tell us how the visit went.",
      submitLabel: "Send feedback",
    },
  ],
  widgets: [
    {
      id: "avg_rating",
      type: "stat",
      entityId: "job",
      title: "Average rating",
      metric: { op: "avg", fieldId: "rating" },
    },
    {
      id: "hours",
      type: "stat",
      entityId: "job",
      title: "Time on jobs",
      metric: { op: "sum", fieldId: "time_spent" },
    },
    {
      id: "jobs_done",
      type: "stat",
      entityId: "job",
      title: "Jobs done",
      filter: "status == 'done'",
      metric: { op: "count" },
    },
    {
      id: "by_tech",
      type: "chart",
      entityId: "job",
      title: "Time by technician",
      metric: { op: "sum", fieldId: "time_spent" },
      chart: { kind: "bar", bucket: "week", groupByFieldId: "technician" },
    },
  ],
  systems: [
    {
      id: "jobs",
      name: "Jobs",
      icon: "briefcase",
      viewIds: ["job_table"],
      widgetIds: ["avg_rating", "hours", "jobs_done", "by_tech"],
    },
    {
      id: "feedback",
      name: "Feedback",
      icon: "megaphone",
      viewIds: ["feedback_table", "rate_us"],
      widgetIds: [],
    },
  ],
  rules: [],
};

const JOBS: [string, string, string, number, number][] = [
  ["Clean split unit, bedroom", "Ana Cruz", "rico", 75, 5],
  ["Freon top-up, 2 HP", "Mark Lim", "joy", 50, 4],
  ["Install window unit", "Liza Tan", "ben", 150, 5],
  ["Fix leaking drain line", "Paolo Reyes", "rico", 95, 3],
  ["Clean 3 units, office", "Dela Peña Law", "joy", 210, 4],
  ["Replace capacitor", "Grace Uy", "ben", 40, 5],
];

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("Local databases only.");
  const problems = validateBlueprint(bp);
  if (problems.length) throw new Error(JSON.stringify(problems));
  const now = new Date();
  const at = now.toISOString();
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const rows: DataRecord[] = JOBS.map(([title, customer, technician, minutes, rating], i) => ({
    id: `job_${i + 1}`,
    entityId: "job",
    data: { title, customer, technician, status: "done", done_on: day(i), time_spent: minutes, rating },
    createdAt: at,
    updatedAt: at,
  }));
  rows.push({
    id: "job_7",
    entityId: "job",
    data: {
      title: "Check noisy outdoor unit",
      customer: "Ramon Go",
      technician: "rico",
      status: "scheduled",
      done_on: day(-1),
    },
    createdAt: at,
    updatedAt: at,
  });
  rows.push({
    id: "fb_1",
    entityId: "feedback",
    data: { name: "Ana Cruz", stars: 5, wait: 20, comments: "Rico was quick and tidy." },
    createdAt: at,
    updatedAt: at,
  });
  const records = computeAll(bp, rows, now);
  const owner = await ownerId();
  await sql`delete from workspace where id = ${SLUG}`.execute(db);
  const meta = {
    name: bp.workspaceName,
    summary: "Aircon jobs and feedback",
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
  console.log(JSON.stringify({ workspace: SLUG, jobs: JOBS.length + 1 }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
