import "server-only";
import { sql } from "kysely";
import { after } from "next/server";
import { isDemoEmail } from "@/lib/auth/demo";
import { limitMessage } from "@/lib/billing/decide";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import {
  applyActions,
  dueRuns,
  type Email,
  isOn,
  isTimed,
  recordLabel,
  type SavedChange,
  saveRuns,
} from "@/lib/engine/automations";
import { computeAll } from "@/lib/engine/compute";
import type { RecordPut } from "@/lib/store/workspace-sync";
import { logActivity, recordEntries } from "./activity";
import { emailRoom } from "./billing/limits";
import { db } from "./db";
import { sendMail } from "./mail";
import { sendAlerts } from "./notifications";
import { queueCalls, queueChanges, sendSoon } from "./webhooks";
import { currentBlueprint, putRecords, readRecords } from "./workspace-data";
import { enterZone } from "./zone";

type Ex = Parameters<typeof readRecords>[0];

/** Tries before a pending email is given up on. */
const MAX_ATTEMPTS = 3;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export type RunTrigger = "save" | "booking" | "schedule" | "date" | "manual";

export type AutomationRun = {
  id: number;
  ruleId: string;
  ruleName: string;
  recordId: string | null;
  recordLabel: string | null;
  trigger: RunTrigger;
  status: "done" | "pending" | "sent" | "failed" | "not_sent";
  detail: string | null;
  emails: Email[] | null;
  createdAt: string;
};

type Row = {
  id: string;
  rule_id: string;
  rule_name: string;
  record_id: string | null;
  record_label: string | null;
  trigger: RunTrigger;
  status: AutomationRun["status"];
  detail: string | null;
  emails: Email[] | null;
  created_at: Date;
};

const toRun = (r: Row): AutomationRun => ({
  id: Number(r.id),
  ruleId: r.rule_id,
  ruleName: r.rule_name,
  recordId: r.record_id,
  recordLabel: r.record_label,
  trigger: r.trigger,
  status: r.status,
  detail: r.detail,
  emails: r.emails,
  createdAt: r.created_at.toISOString(),
});

/**
 * Sends these runs' emails once the response is out (after a save or a booking). Outside a request (scripts) it
 * just starts them. Anything that doesn't go is left pending for the runner's next pass.
 */
export function deliverSoon(ids: number[]) {
  if (!ids.length) return;
  const send = () =>
    deliverPending(ids).catch((error) =>
      console.error(JSON.stringify({ event: "automation_email_error", error: String(error) })),
    );
  try {
    after(send);
  } catch {
    void send();
  }
}

/** Rules that can fire on a save, for a quick check before reading anything. */
export const fireOnSave = (bp: Blueprint | undefined) =>
  !!bp?.rules.some((r) => isOn(r) && ["created", "updated", "status_changed"].includes(r.trigger.event));

/**
 * Records what a save set off, inside the save's transaction: one row per automation that fired, with the emails
 * it sends waiting as pending and the outside calls it makes queued on their webhook endpoints (sent after the
 * commit, with the endpoint's retries). Returns the ids of runs whose emails to deliver after the commit.
 */
export async function logSaveRuns(
  trx: Ex,
  workspaceId: string,
  bp: Blueprint,
  changes: SavedChange[],
  records: DataRecord[],
  trigger: "save" | "booking",
  now = new Date(),
): Promise<number[]> {
  const runs = saveRuns(bp, changes, records, now);
  if (!runs.length) return [];
  // Outside calls first, so each run's log says whether its calls went out or why not.
  const called = new Map<number, string | null>();
  let queued = 0;
  for (const [i, r] of runs.entries()) {
    if (!r.calls.length) continue;
    const done = await queueCalls(trx, workspaceId, r.calls);
    queued += done.queued;
    called.set(
      i,
      [
        done.queued ? `Called ${done.queued} webhook endpoint${done.queued === 1 ? "" : "s"}.` : "",
        ...done.problems,
      ]
        .filter(Boolean)
        .join(" ") || null,
    );
  }
  // Notifications: members are notified in the app now; everyone else's emails go out with the run's others.
  const alerted = new Map<number, Awaited<ReturnType<typeof sendAlerts>>>();
  for (const [i, r] of runs.entries())
    if (r.alerts.length) alerted.set(i, await sendAlerts(trx, workspaceId, r.rule, r.alerts));
  const rows = runs.map((r, i) => {
    const emails = [...r.emails, ...(alerted.get(i)?.emails ?? [])];
    return {
      workspace_id: workspaceId,
      rule_id: r.rule.id,
      rule_name: r.rule.name,
      record_id: r.record.id,
      record_label: recordLabel(bp, r.record, records),
      trigger,
      status: emails.length ? "pending" : "done",
      emails: emails.length ? emails : null,
      detail: [alerted.get(i)?.detail, called.get(i)].filter(Boolean).join(" ") || null,
    };
  });
  const { rows: ids } = await sql<{ id: string; status: string }>`
    insert into automation_run (workspace_id, rule_id, rule_name, record_id, record_label, trigger, status, emails,
      detail, finished_at)
    select x.workspace_id, x.rule_id, x.rule_name, x.record_id, x.record_label, x.trigger, x.status, x.emails, x.detail,
      case when x.status = 'done' then now() end
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(workspace_id text, rule_id text, rule_name text,
      record_id text, record_label text, trigger text, status text, emails jsonb, detail text)
    returning id, status`.execute(trx);
  // Sent once the response is out; a call made before the commit lands waits for the runner's next pass.
  sendSoon(queued);
  return ids.filter((r) => r.status === "pending").map((r) => Number(r.id));
}

/**
 * Sends pending emails (the given runs, or the oldest pending ones). A run whose emails all went is sent; one
 * without SMTP, over the daily limit or on the demo account is not_sent with the reason; a failure is retried by
 * the next pass, up to MAX_ATTEMPTS.
 */
export async function deliverPending(ids?: number[], limit = 50): Promise<{ sent: number; failed: number }> {
  const { rows } = await sql<{
    id: string;
    workspace_id: string;
    emails: Email[];
    attempts: number;
    owner_email: string | null;
  }>`
    select r.id, r.workspace_id, r.emails, r.attempts, u.email as owner_email
    from automation_run r join workspace w on w.id = r.workspace_id left join "user" u on u.id = w.owner_id
    where r.status = 'pending' ${ids ? sql`and r.id = any(${ids}::bigint[])` : sql``}
    order by r.created_at limit ${limit}`.execute(db);
  let sent = 0;
  let failed = 0;
  for (const run of rows) {
    // Claim it, so two runners never send the same email.
    const claimed = await sql`update automation_run set attempts = attempts + 1
      where id = ${run.id} and status = 'pending' and attempts = ${run.attempts}`.execute(db);
    if (!Number(claimed.numAffectedRows ?? 0)) continue;
    const finish = (status: AutomationRun["status"], detail: string) =>
      sql`update automation_run set status = ${status}, detail = ${detail}, finished_at = now()
        where id = ${run.id}`.execute(db);
    if (isDemoEmail(run.owner_email)) {
      await finish("not_sent", "The shared demo account doesn't send email.");
      continue;
    }
    const bad = run.emails.filter((e) => !EMAIL.test(e.to));
    const good = run.emails.filter((e) => EMAIL.test(e.to));
    // The owner's plan sets the day's emails across all their workspaces (AUTOMATION_EMAIL_DAILY_LIMIT caps it).
    const room = await emailRoom(run.workspace_id);
    if (room.suspended) {
      await finish("not_sent", "This account is suspended, so automations don't send email.");
      continue;
    }
    if (good.length > room.left) {
      await finish("not_sent", limitMessage("emailsPerDay", room.plan));
      continue;
    }
    if (!good.length) {
      await finish("not_sent", `No email address to send to${bad[0]?.to ? ` ("${bad[0].to}")` : ""}.`);
      continue;
    }
    const results = await Promise.all(
      good.map((e) =>
        sendMail({ to: e.to, subject: e.subject, text: e.body, html: emailHtml(e.body) }).then((ok) => ({
          e,
          ok,
        })),
      ),
    );
    const notSent = results.filter((r) => !r.ok);
    const skipped = bad.length ? ` Skipped ${bad.map((b) => b.to || "a blank address").join(", ")}.` : "";
    if (!notSent.length) {
      sent++;
      await finish("sent", `Sent to ${good.map((g) => g.to).join(", ")}.${skipped}`);
    } else if (!process.env.SMTP_HOST) {
      await finish(
        "not_sent",
        "Email isn't set up on this server (SMTP), so it was written to the log instead.",
      );
    } else if (run.attempts + 1 >= MAX_ATTEMPTS) {
      failed++;
      await finish(
        "failed",
        `Couldn't send to ${notSent.map((r) => r.e.to).join(", ")} after ${MAX_ATTEMPTS} tries.`,
      );
    } else {
      await sql`update automation_run set detail = ${"Sending failed; it will be tried again."}
        where id = ${run.id}`.execute(db);
    }
  }
  return { sent, failed };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** The message as simple HTML: paragraphs and line breaks, everything escaped. */
function emailHtml(body: string) {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1c1917">${paragraphs}</div>`;
}

/**
 * Runs timed automations (schedules and dates) that are due. Each workspace is locked while its records change,
 * like a save. ruleId and force run one automation now (Run now), whatever its time.
 */
export async function runTimedAutomations(
  now = new Date(),
  options: { workspaceId?: string; ruleId?: string; force?: boolean } = {},
): Promise<{ workspaces: number; runs: number; pending: number[] }> {
  const { rows: candidates } = await sql<{ id: string }>`
    select w.id from workspace w
    join workspace_version v on v.workspace_id = w.id and v.version = (w.doc->>'currentVersion')::int
    where jsonb_path_exists(v.blueprint,
      '$.rules[*] ? (@.trigger.event == "schedule" || @.trigger.event == "date_reached")')
      ${options.workspaceId ? sql`and w.id = ${options.workspaceId}` : sql``}`.execute(db);
  let runs = 0;
  const pending: number[] = [];
  for (const { id } of candidates) {
    try {
      const done = await db.transaction().execute(async (trx) => {
        await sql`select 1 from workspace where id = ${id} for update`.execute(trx);
        const bp = await currentBlueprint(trx, id);
        // Each workspace's schedules and dates run on its own clock.
        enterZone(bp);
        if (!bp || !bp.rules.some((r) => isOn(r) && isTimed(r)))
          return { runs: 0, pending: [] as number[], hooks: 0 };
        const stored = await readRecords(trx, id);
        let records = stored.map((s) => s.record);
        const due = dueRuns(bp, records, now, { ruleId: options.ruleId, force: options.force });
        const ids: number[] = [];
        let count = 0;
        let calls = 0;
        const ran = new Map<string, { name: string; records: string[]; notes: string[] }>();
        for (const run of due) {
          const key = options.force ? `manual:${now.getTime()}:${run.key}` : run.key;
          const label = recordLabel(bp, run.record, records);
          const trigger = options.force
            ? "manual"
            : run.rule.trigger.event === "schedule"
              ? "schedule"
              : "date";
          // The key is claimed first: a run that already happened (another pass, another instance) is skipped.
          const { rows: claimed } = await sql<{ id: string }>`
            insert into automation_run (workspace_id, rule_id, rule_name, record_id, record_label, trigger, run_key,
              status)
            values (${id}, ${run.rule.id}, ${run.rule.name}, ${run.record.id}, ${label}, ${trigger}, ${key}, 'running')
            on conflict (workspace_id, run_key) where run_key is not null do nothing
            returning id`.execute(trx);
          const runId = claimed[0]?.id;
          if (!runId) continue;
          const current = records.find((r) => r.id === run.record.id) ?? run.record;
          const outcome = applyActions(bp, records, run.rule, current, now);
          records = outcome.records;
          count++;
          const called = await queueCalls(trx, id, outcome.calls);
          calls += called.queued;
          const alerted = await sendAlerts(trx, id, run.rule, outcome.alerts);
          const emails = [...outcome.emails, ...alerted.emails];
          const added = outcome.created.length
            ? `Added ${outcome.created.length} record${outcome.created.length === 1 ? "" : "s"}.`
            : "";
          const reached = called.queued
            ? `Called ${called.queued} webhook endpoint${called.queued === 1 ? "" : "s"}.`
            : "";
          const detail =
            [added, reached, alerted.detail, ...called.problems, ...outcome.notices]
              .filter(Boolean)
              .join(" ") || null;
          const r = ran.get(run.rule.id) ?? { name: run.rule.name, records: [], notes: [] };
          r.records.push(run.record.id);
          if (detail) r.notes.push(detail);
          ran.set(run.rule.id, r);
          await sql`update automation_run set
              status = ${emails.length ? "pending" : "done"},
              emails = ${emails.length ? JSON.stringify(emails) : null}::jsonb,
              detail = ${detail},
              finished_at = ${emails.length ? null : now}
            where id = ${runId}`.execute(trx);
          if (emails.length) ids.push(Number(runId));
        }
        if (!count) return { runs: 0, pending: ids, hooks: calls };
        const computed = computeAll(bp, records, now);
        const before = new Map(stored.map((s) => [s.record.id, s]));
        const writes = computed.flatMap((r): RecordPut[] => {
          const was = before.get(r.id);
          if (!was) return [{ record: r, rev: null }];
          return JSON.stringify(was.record.data) === JSON.stringify(r.data)
            ? []
            : [{ record: r, rev: was.rev }];
        });
        if (writes.length) {
          // One rule's writes read as that rule; a pass where several ran reads "Automations".
          const rules = [...ran.entries()];
          const saved = await putRecords(
            trx,
            id,
            writes,
            rules.length === 1
              ? { type: "automation", id: rules[0][0], name: `Automation · ${rules[0][1].name}` }
              : { type: "automation", name: "Automations" },
          );
          if (saved.conflicts.length)
            throw new Error(`automation write conflicted on ${saved.conflicts.join(", ")}`);
          await sql`update workspace set updated_at = now() where id = ${id}`.execute(trx);
        }
        // Each automation that ran, then the records the pass changed, named after the automations.
        for (const [ruleId, r] of ran)
          await logActivity(
            trx,
            { type: "automation", id: ruleId, name: r.name },
            {
              workspaceId: id,
              action: "automation.run",
              target: r.name,
              ids: r.records,
              detail:
                [options.force ? "Run now" : null, ...new Set(r.notes)]
                  .filter(Boolean)
                  .join(" ")
                  .slice(0, 500) || null,
            },
          );
        if (writes.length)
          await logActivity(
            trx,
            {
              type: "automation",
              id: [...ran.keys()].join(","),
              name: [...ran.values()].map((r) => r.name).join(", "),
            },
            recordEntries(id, writes),
          );
        const hooks = writes.length
          ? await queueChanges(
              trx,
              id,
              bp,
              writes.map((w) => ({ before: before.get(w.record.id)?.record, after: w.record })),
            )
          : 0;
        return { runs: count, pending: ids, hooks: hooks + calls };
      });
      runs += done.runs;
      pending.push(...done.pending);
      sendSoon(done.hooks);
    } catch (error) {
      console.error(JSON.stringify({ event: "automation_timed_error", workspace: id, error: String(error) }));
    }
  }
  return { workspaces: candidates.length, runs, pending };
}

/** Recent runs of a workspace's automations, newest first. */
export async function listRuns(workspaceId: string, limit = 50): Promise<AutomationRun[]> {
  const { rows } = await sql<Row>`
    select id, rule_id, rule_name, record_id, record_label, trigger, status, detail, emails, created_at
    from automation_run where workspace_id = ${workspaceId} and status <> 'running'
    order by created_at desc, id desc limit ${limit}`.execute(db);
  return rows.map(toRun);
}
