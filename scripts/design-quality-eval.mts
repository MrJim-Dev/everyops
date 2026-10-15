/** Real setup generation against a running local server; no workspace is saved or applied. */
import { writeFileSync } from "node:fs";
import { validateBlueprint } from "@/lib/blueprint/validate";
import type { SetupDraft } from "@/lib/store/workspace-model";

const base = process.env.EVAL_BASE ?? "http://localhost:3000";
const repeat = Math.max(1, Math.min(5, Number(process.env.EVAL_REPEAT) || 1));
const brief =
  "Build a small repair shop called Fixwell. Track customers with name and phone, repair jobs linked to customers with item description and quoted price, and job statuses Received, In progress, Ready, Collected and Cancelled. Give staff a jobs table and status board, a customers table, and an overview showing jobs awaiting collection. Keep all pages private. No online booking or checkout.";
const signin = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({
    email: process.env.EVAL_EMAIL ?? "james@everyops.app",
    password: process.env.EVAL_PASSWORD ?? "everyops2026",
  }),
});
if (!signin.ok) throw new Error(`Sign-in failed: ${signin.status}`);
const cookie = signin.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const rows = [];
for (let run = 0; run < repeat; run++) {
  const start = Date.now();
  const response = await fetch(`${base}/api/ai/design`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify({ brief, workspaceName: "Fixwell" }),
  });
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const draft = events.find((event) => event.type === "done")?.draft as SetupDraft | undefined;
  const bp = draft?.data.blueprint;
  const customer = bp?.entities.find((e) => /customer/i.test(e.name));
  const job = bp?.entities.find((e) => /job/i.test(e.name));
  const status = job?.fields.find((f) => f.type === "status");
  const ready = status?.options?.find((o) => o.label.toLowerCase() === "ready");
  const overview = bp?.systems.find((s) => /overview/i.test(s.name));
  const checks = {
    valid: !!bp && validateBlueprint(bp).length === 0,
    reviewed: (draft?.coverage?.length ?? 0) >= 3,
    customerFields:
      !!customer &&
      /name/i.test(customer.fields.find((f) => f.id === customer.primaryFieldId)?.name ?? "") &&
      customer.fields.some((f) => /phone/i.test(f.name)),
    jobFields:
      !!job &&
      job.fields.some((f) => f.relation?.entityId === customer?.id) &&
      job.fields.some((f) => /item|description/i.test(f.name)) &&
      job.fields.some((f) => /quoted.*price/i.test(f.name) && f.type === "money"),
    statuses: ["received", "in progress", "ready", "collected", "cancelled"].every((label) =>
      status?.options?.some((o) => o.label.toLowerCase() === label),
    ),
    jobsTable: !!job && !!bp?.views.some((v) => v.entityId === job.id && v.type === "table"),
    customersTable: !!customer && !!bp?.views.some((v) => v.entityId === customer.id && v.type === "table"),
    board:
      !!job &&
      !!bp?.views.some((v) => v.entityId === job.id && v.type === "kanban" && v.statusFieldId === status?.id),
    awaitingCollection:
      !!ready &&
      !!overview &&
      !!bp?.widgets.some(
        (w) =>
          overview.widgetIds.includes(w.id) &&
          w.entityId === job?.id &&
          (w.filter ?? "").includes(`'${ready.id}'`),
      ),
    private: !!bp && !bp.views.some((v) => "public" in v && v.public),
    noBookingOrCheckout:
      !!bp &&
      !bp.entities.some((e) => e.booking) &&
      !bp.views.some((v) => v.type === "checkout" || v.type === "slot_grid"),
  };
  const row = {
    run: run + 1,
    ms: Date.now() - start,
    pass: Object.values(checks).every(Boolean),
    checks,
    stages: events.filter((e) => e.type === "stage"),
    draft,
  };
  rows.push(row);
  console.log(JSON.stringify({ ...row, draft: undefined }));
  if (process.env.EVAL_REPORT)
    writeFileSync(
      process.env.EVAL_REPORT,
      JSON.stringify({ at: new Date().toISOString(), base, brief, rows }, null, 2),
    );
}
process.exitCode = rows.every((row) => row.pass) ? 0 : 1;
