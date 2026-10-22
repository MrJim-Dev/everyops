import "server-only";
import { randomBytes } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { type Kysely, sql, type Transaction } from "kysely";
import { after } from "next/server";
import type { Blueprint } from "@/lib/blueprint/types";
import { signature } from "@/lib/webhook-signature";
import {
  DISABLE_AFTER,
  type EventDraft,
  eventsFor,
  isPrivateAddress,
  nextAttempt,
  type RecordChange,
  urlProblem,
  wants,
} from "@/lib/webhooks";
import { type Database, db } from "./db";
import { appUrl, sendMail } from "./mail";

/**
 * Webhook outbox and sender. Writes call queueChanges inside their transaction: when the workspace has endpoints,
 * one delivery row per endpoint that wants each event is inserted with the change. After the commit sendSoon posts
 * them; failures are retried with backoff (RETRY_MINUTES) by the cron job until they succeed or 24 hours pass.
 */

type Ex = Kysely<Database> | Transaction<Database>;

const id = (prefix: string, n = 12) => `${prefix}${randomBytes(n).toString("base64url")}`;

type Sub = { id: string; events: string[]; entity_ids: string[] | null };

/** Queues events for every enabled endpoint that wants them; answers how many deliveries were queued. */
export async function queueEvents(ex: Ex, workspaceId: string, events: EventDraft[], now = new Date()) {
  if (!events.length) return 0;
  const { rows: subs } = await sql<Sub>`select id, events, entity_ids from webhook_endpoint
    where workspace_id = ${workspaceId} and enabled`.execute(ex);
  if (!subs.length) return 0;
  const rows: { endpoint: string; event: string; type: string; payload: string }[] = [];
  for (const e of events) {
    const eventId = id("evt_");
    const payload = JSON.stringify({
      id: eventId,
      type: e.type,
      workspace: workspaceId,
      occurredAt: now.toISOString(),
      data: e.data,
    });
    for (const s of subs)
      if (wants({ events: s.events, entityIds: s.entity_ids }, e))
        rows.push({ endpoint: s.id, event: eventId, type: e.type, payload });
  }
  if (!rows.length) return 0;
  await sql`insert into webhook_delivery (endpoint_id, workspace_id, event_id, event_type, payload)
    select x.endpoint, ${workspaceId}, x.event, x.type, x.payload::jsonb
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(endpoint text, event text, type text, payload text)`.execute(
    ex,
  );
  return rows.length;
}

/** Automation calls one workspace may make in a day, so a schedule over many records can't flood a service. */
const DAILY_CALLS = Number(process.env.AUTOMATION_CALL_DAILY_LIMIT ?? 500);

/**
 * Queues automations' calls, inside the transaction of the save or run that made them. Each goes to the endpoint
 * it names (only this workspace's, and only while it's on and accepts automation calls), with the body as posted,
 * so services that expect their own JSON (Slack's {"text": …}) get exactly that. Answers how many were queued and
 * why any weren't, for the run's log.
 */
export async function queueCalls(
  ex: Ex,
  workspaceId: string,
  calls: { endpointId: string; body: unknown }[],
): Promise<{ queued: number; problems: string[] }> {
  if (!calls.length) return { queued: 0, problems: [] };
  const ids = [...new Set(calls.map((c) => c.endpointId))];
  const { rows: endpoints } = await sql<{
    id: string;
    enabled: boolean;
    events: string[];
    description: string | null;
  }>`
    select id, enabled, events, description from webhook_endpoint
    where workspace_id = ${workspaceId} and id = any(${ids})`.execute(ex);
  const { rows: today } = await sql<{ n: number }>`select count(*)::int as n from webhook_delivery
    where workspace_id = ${workspaceId} and event_type = 'automation.call'
      and created_at >= date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'`.execute(
    ex,
  );
  let room = Math.max(0, DAILY_CALLS - (today[0]?.n ?? 0));
  const problems = new Set<string>();
  const rows: { endpoint: string; event: string; payload: string }[] = [];
  for (const call of calls) {
    const endpoint = endpoints.find((e) => e.id === call.endpointId);
    if (!endpoint) problems.add(`The webhook endpoint ${call.endpointId} doesn't exist any more.`);
    else if (!endpoint.enabled)
      problems.add(`${endpoint.description || "The webhook endpoint"} is turned off.`);
    else if (!endpoint.events.includes("automation.call"))
      problems.add(`${endpoint.description || "The webhook endpoint"} doesn't accept automation calls.`);
    else if (room <= 0) problems.add(`Today's limit of ${DAILY_CALLS} automation calls is reached.`);
    else {
      room--;
      rows.push({ endpoint: endpoint.id, event: id("evt_"), payload: JSON.stringify(call.body ?? {}) });
    }
  }
  if (rows.length)
    await sql`insert into webhook_delivery (endpoint_id, workspace_id, event_id, event_type, payload)
      select x.endpoint, ${workspaceId}, x.event, 'automation.call', x.payload::jsonb
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(endpoint text, event text, payload text)`.execute(
      ex,
    );
  return { queued: rows.length, problems: [...problems] };
}

/** Record changes (and any other events, like a public form submission) as queued deliveries. */
export const queueChanges = (
  ex: Ex,
  workspaceId: string,
  bp: Blueprint,
  changes: RecordChange[],
  extra: EventDraft[] = [],
) => queueEvents(ex, workspaceId, [...eventsFor(bp, changes), ...extra]);

/** Whether a workspace has any enabled endpoint (so a save knows to read records' previous values). */
export async function hasEndpoints(ex: Ex, workspaceId: string) {
  const { rows } =
    await sql`select 1 from webhook_endpoint where workspace_id = ${workspaceId} and enabled limit 1`.execute(
      ex,
    );
  return rows.length > 0;
}

/** Sends queued deliveries once the response is out; anything that fails waits for its retry. */
export function sendSoon(queued: number) {
  if (!queued) return;
  const send = () =>
    deliverWebhooks().catch((error) =>
      console.error(JSON.stringify({ event: "webhook_send_error", error: String(error) })),
    );
  try {
    after(send);
  } catch {
    void send();
  }
}

/** Resolves a hostname and refuses private addresses, on every connection (so DNS can't be swapped after a check). */
function publicLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: Error | null, address?: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address)))
      return callback(new Error("The URL resolves to a private or internal address."));
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

type Sent = { ok: boolean; status: number | null; error: string | null; ms: number };

/** POSTs one delivery: 10 seconds, no redirects, at most 2 KB of the answer read. */
function post(url: string, body: string, headers: Record<string, string>): Promise<Sent> {
  const started = Date.now();
  return new Promise((resolve) => {
    const problem = urlProblem(url);
    if (problem) return resolve({ ok: false, status: null, error: problem, ms: 0 });
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        lookup: publicLookup as never,
        timeout: 10_000,
      },
      (res) => {
        let read = 0;
        res.on("data", (chunk: Buffer) => {
          read += chunk.length;
          if (read > 2048) res.destroy();
        });
        const done = () => {
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          resolve({
            ok,
            status,
            error: ok
              ? null
              : status >= 300 && status < 400
                ? "Redirects aren't followed."
                : `HTTP ${status}`,
            ms: Date.now() - started,
          });
        };
        res.on("end", done);
        res.on("close", done);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out after 10 seconds.")));
    req.on("error", (e) =>
      resolve({ ok: false, status: null, error: e.message.slice(0, 300), ms: Date.now() - started }),
    );
    req.end(body);
  });
}

type Claimed = {
  id: string;
  endpoint_id: string;
  workspace_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  created_at: Date;
  url: string;
  secret: string;
};

/**
 * Sends what's due: pending deliveries whose time has come (and any left "sending" by an instance that stopped),
 * claimed so two instances never send the same one. Answers how many went and how many failed.
 */
export async function deliverWebhooks(limit = 50): Promise<{ sent: number; failed: number }> {
  const { rows } = await sql<Claimed>`
    with due as (
      select d.id from webhook_delivery d join webhook_endpoint e on e.id = d.endpoint_id and e.enabled
      where (d.status = 'pending' and d.next_attempt_at <= now())
         or (d.status = 'sending' and d.last_attempt_at < now() - interval '5 minutes')
      order by d.next_attempt_at limit ${limit} for update of d skip locked)
    update webhook_delivery d set status = 'sending', attempts = d.attempts + 1, last_attempt_at = now()
    from due, webhook_endpoint e where d.id = due.id and e.id = d.endpoint_id
    returning d.id, d.endpoint_id, d.workspace_id, d.event_id, d.event_type, d.payload, d.attempts, d.created_at,
      e.url, e.secret`.execute(db);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    rows.map(async (d) => {
      const body = JSON.stringify(d.payload);
      const result = await post(d.url, body, {
        "user-agent": "EveryOps-Webhooks/1.0 (+https://everyops.app/developers)",
        "everyops-event": d.event_type,
        "everyops-event-id": d.event_id,
        "everyops-delivery": d.id,
        "everyops-signature": signature(d.secret, body),
      });
      if (result.ok) sent++;
      else failed++;
      await record(d, result);
    }),
  );
  return { sent, failed };
}

async function record(d: Claimed, r: Sent) {
  const retryAt = r.ok ? null : nextAttempt(d.attempts, d.created_at);
  await sql`update webhook_delivery set
      status = ${r.ok ? "delivered" : retryAt ? "pending" : "failed"},
      next_attempt_at = coalesce(${retryAt}, next_attempt_at),
      last_status = ${r.status}, last_error = ${r.error}, last_duration_ms = ${r.ms},
      delivered_at = ${r.ok ? new Date() : null}
    where id = ${d.id}`.execute(db);
  if (r.ok) {
    await sql`update webhook_endpoint set failures = 0, last_success_at = now() where id = ${d.endpoint_id}`.execute(
      db,
    );
    return;
  }
  const { rows } = await sql<{ failures: number; enabled: boolean }>`
    update webhook_endpoint set failures = failures + 1,
      enabled = case when failures + 1 >= ${DISABLE_AFTER} then false else enabled end,
      disabled_reason = case when failures + 1 >= ${DISABLE_AFTER} and enabled
        then ${`Turned off after ${DISABLE_AFTER} failed deliveries in a row (last: ${r.error ?? "no answer"}).`} else disabled_reason end
    where id = ${d.endpoint_id} returning failures, enabled`.execute(db);
  if (rows[0] && !rows[0].enabled && rows[0].failures === DISABLE_AFTER) await tellOwner(d, r.error);
}

/** Emails the workspace's owner that an endpoint was switched off. */
async function tellOwner(d: Claimed, error: string | null) {
  const { rows } = await sql<{ email: string; name: string }>`
    select u.email, w.doc->>'name' as name from workspace w join "user" u on u.id = w.owner_id where w.id = ${d.workspace_id}`.execute(
    db,
  );
  const owner = rows[0];
  if (!owner) return;
  const link = `${appUrl()}/w/${d.workspace_id}/settings/webhooks`;
  const text = `EveryOps stopped sending webhooks to ${d.url} for ${owner.name ?? d.workspace_id} after ${DISABLE_AFTER} failed deliveries in a row.\n\nLast error: ${error ?? "no answer"}\n\nFix the endpoint, then turn it back on and resend what it missed: ${link}`;
  await sendMail({
    to: owner.email,
    subject: `Webhook turned off: ${new URL(d.url).hostname}`,
    text,
    html: text.replaceAll("\n", "<br>"),
  }).catch(() => false);
}

// ---- Endpoints and deliveries, for Settings → Webhooks ----

export type EndpointInfo = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  entityIds: string[] | null;
  enabled: boolean;
  disabledReason: string | null;
  failures: number;
  lastSuccessAt: string | null;
  createdAt: string;
  recent: { delivered: number; failed: number; pending: number };
};

export async function listEndpoints(workspaceId: string): Promise<EndpointInfo[]> {
  const { rows } = await sql<{
    id: string;
    url: string;
    description: string | null;
    events: string[];
    entity_ids: string[] | null;
    enabled: boolean;
    disabled_reason: string | null;
    failures: number;
    last_success_at: Date | null;
    created_at: Date;
    delivered: number;
    failed: number;
    pending: number;
  }>`
    select e.*, count(d.*) filter (where d.status = 'delivered')::int as delivered,
      count(d.*) filter (where d.status = 'failed')::int as failed,
      count(d.*) filter (where d.status in ('pending', 'sending'))::int as pending
    from webhook_endpoint e left join webhook_delivery d on d.endpoint_id = e.id and d.created_at > now() - interval '7 days'
    where e.workspace_id = ${workspaceId} group by e.id order by e.created_at`.execute(db);
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    description: r.description,
    events: r.events,
    entityIds: r.entity_ids,
    enabled: r.enabled,
    disabledReason: r.disabled_reason,
    failures: r.failures,
    lastSuccessAt: r.last_success_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    recent: { delivered: r.delivered, failed: r.failed, pending: r.pending },
  }));
}

export type EndpointInput = {
  url: string;
  description: string | null;
  events: string[];
  entityIds: string[] | null;
};

export async function createEndpoint(workspaceId: string, userId: string, input: EndpointInput) {
  const secret = id("whsec_", 24);
  const endpointId = id("we_", 9);
  await sql`insert into webhook_endpoint (id, workspace_id, url, description, secret, events, entity_ids, created_by)
    values (${endpointId}, ${workspaceId}, ${input.url}, ${input.description}, ${secret}, ${input.events}::text[],
      ${input.entityIds}::text[], ${userId})`.execute(db);
  return { id: endpointId, secret };
}

export async function updateEndpoint(
  workspaceId: string,
  endpointId: string,
  patch: Partial<EndpointInput> & { enabled?: boolean; rotateSecret?: boolean },
): Promise<{ found: boolean; secret?: string }> {
  const secret = patch.rotateSecret ? id("whsec_", 24) : null;
  const { rows } = await sql<{ id: string }>`update webhook_endpoint set
      url = coalesce(${patch.url ?? null}, url),
      description = case when ${patch.description !== undefined} then ${patch.description ?? null} else description end,
      events = coalesce(${patch.events ?? null}::text[], events),
      entity_ids = case when ${patch.entityIds !== undefined} then ${patch.entityIds ?? null}::text[] else entity_ids end,
      enabled = coalesce(${patch.enabled ?? null}, enabled),
      failures = case when ${patch.enabled === true} then 0 else failures end,
      disabled_reason = case when ${patch.enabled === true} then null else disabled_reason end,
      secret = coalesce(${secret}, secret)
    where id = ${endpointId} and workspace_id = ${workspaceId} returning id`.execute(db);
  return { found: rows.length > 0, ...(secret ? { secret } : {}) };
}

export async function deleteEndpoint(workspaceId: string, endpointId: string) {
  const done =
    await sql`delete from webhook_endpoint where id = ${endpointId} and workspace_id = ${workspaceId}`.execute(
      db,
    );
  return Number(done.numAffectedRows ?? 0) > 0;
}

export async function endpointSecret(workspaceId: string, endpointId: string) {
  const { rows } = await sql<{ secret: string }>`select secret from webhook_endpoint
    where id = ${endpointId} and workspace_id = ${workspaceId}`.execute(db);
  return rows[0]?.secret ?? null;
}

export type DeliveryInfo = {
  id: number;
  eventId: string;
  eventType: string;
  status: "pending" | "sending" | "delivered" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  durationMs: number | null;
  createdAt: string;
  nextAttemptAt: string | null;
  payload: unknown;
};

export async function listDeliveries(
  workspaceId: string,
  endpointId: string,
  limit = 30,
): Promise<DeliveryInfo[]> {
  const { rows } = await sql<{
    id: string;
    event_id: string;
    event_type: string;
    status: DeliveryInfo["status"];
    attempts: number;
    last_status: number | null;
    last_error: string | null;
    last_duration_ms: number | null;
    created_at: Date;
    next_attempt_at: Date;
    payload: unknown;
  }>`select * from webhook_delivery where endpoint_id = ${endpointId} and workspace_id = ${workspaceId}
    order by created_at desc, id desc limit ${limit}`.execute(db);
  return rows.map((r) => ({
    id: Number(r.id),
    eventId: r.event_id,
    eventType: r.event_type,
    status: r.status,
    attempts: r.attempts,
    lastStatus: r.last_status,
    lastError: r.last_error,
    durationMs: r.last_duration_ms,
    createdAt: r.created_at.toISOString(),
    nextAttemptAt: r.status === "pending" ? r.next_attempt_at.toISOString() : null,
    payload: r.payload,
  }));
}

/** Sends a delivery again as a new attempt with the same event id and body, so receivers can de-duplicate. */
export async function resend(workspaceId: string, endpointId: string, deliveryId: number) {
  const { rows } = await sql<{
    id: string;
  }>`insert into webhook_delivery (endpoint_id, workspace_id, event_id, event_type, payload)
    select endpoint_id, workspace_id, event_id, event_type, payload from webhook_delivery
    where id = ${deliveryId} and endpoint_id = ${endpointId} and workspace_id = ${workspaceId} returning id`.execute(
    db,
  );
  if (rows.length) sendSoon(1);
  return rows.length > 0;
}

/** Queues a webhook.test event for one endpoint, whatever it subscribes to. */
export async function sendTest(workspaceId: string, endpointId: string) {
  const eventId = id("evt_");
  const payload = {
    id: eventId,
    type: "webhook.test",
    workspace: workspaceId,
    occurredAt: new Date().toISOString(),
    data: { message: "This is a test event from EveryOps." },
  };
  const { rows } = await sql<{
    id: string;
  }>`insert into webhook_delivery (endpoint_id, workspace_id, event_id, event_type, payload)
    select id, workspace_id, ${eventId}, 'webhook.test', ${JSON.stringify(payload)}::jsonb from webhook_endpoint
    where id = ${endpointId} and workspace_id = ${workspaceId} returning id`.execute(db);
  if (rows.length) sendSoon(1);
  return rows.length > 0;
}

/** Deliveries older than 30 days are dropped by the cron job. */
export async function trimDeliveries() {
  const done =
    await sql`delete from webhook_delivery where created_at < now() - interval '30 days' and status in ('delivered', 'failed')`.execute(
      db,
    );
  return Number(done.numAffectedRows ?? 0);
}
