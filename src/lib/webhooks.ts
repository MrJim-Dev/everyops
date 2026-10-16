import type { Blueprint, DataRecord } from "@/lib/blueprint/types";

/**
 * Webhooks: the events a workspace sends, how a change becomes events, how deliveries are signed, when they're
 * retried, and which URLs may receive them. Pure, so it can be tested; the outbox and sender are in
 * src/server/webhooks.ts.
 */

export const WEBHOOK_EVENTS = [
  "record.created",
  "record.updated",
  "record.deleted",
  "record.status_changed",
  "public_form.submitted",
  "change.applied",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const EVENT_LABELS: Record<WebhookEvent, string> = {
  "record.created": "A record is added",
  "record.updated": "A record changes",
  "record.deleted": "A record is deleted",
  "record.status_changed": "A record's status changes",
  "public_form.submitted": "A public form is submitted",
  "change.applied": "A design change is applied",
};

/** One event before it's addressed to endpoints. recordType is null for events about the whole workspace. */
export type EventDraft = { type: WebhookEvent; recordType: string | null; data: Record<string, unknown> };

export type RecordChange = { before?: DataRecord; after?: DataRecord };

const flat = (r: DataRecord) => ({ id: r.id, ...r.data });

/**
 * The events a batch of record changes sends: created, updated (with the field ids that changed), deleted, and
 * status_changed for each status field that changed (with the old and new choice ids and labels). Records whose
 * data didn't change send nothing.
 */
export function eventsFor(bp: Blueprint, changes: RecordChange[]): EventDraft[] {
  const out: EventDraft[] = [];
  for (const { before, after } of changes) {
    const record = after ?? before;
    if (!record) continue;
    const entity = bp.entities.find((e) => e.id === record.entityId);
    const recordType = record.entityId;
    if (!before && after) {
      out.push({ type: "record.created", recordType, data: { recordType, record: flat(after) } });
      continue;
    }
    if (before && !after) {
      out.push({ type: "record.deleted", recordType, data: { recordType, record: flat(before) } });
      continue;
    }
    if (!before || !after) continue;
    const keys = new Set([...Object.keys(before.data), ...Object.keys(after.data)]);
    const changed = [...keys].filter((k) => JSON.stringify(before.data[k]) !== JSON.stringify(after.data[k]));
    if (!changed.length) continue;
    out.push({
      type: "record.updated",
      recordType,
      data: { recordType, record: flat(after), changedFields: changed },
    });
    for (const f of entity?.fields ?? []) {
      if (!changed.includes(f.id) || (f.type !== "status" && f.id !== entity?.booking?.statusFieldId))
        continue;
      const label = (v: unknown) =>
        f.options?.find((o) => o.id === v)?.label ?? (v == null ? null : String(v));
      out.push({
        type: "record.status_changed",
        recordType,
        data: {
          recordType,
          record: flat(after),
          field: f.id,
          from: before.data[f.id] ?? null,
          to: after.data[f.id] ?? null,
          fromLabel: label(before.data[f.id]),
          toLabel: label(after.data[f.id]),
        },
      });
    }
  }
  return out;
}

/** Whether an endpoint subscribed to these events and record types wants this event. */
export const wants = (sub: { events: string[]; entityIds: string[] | null }, e: EventDraft) =>
  sub.events.includes(e.type) &&
  (!sub.entityIds?.length || e.recordType === null || sub.entityIds.includes(e.recordType));

/** Minutes to wait before each retry; after the last, or 24 hours after the event, the delivery fails. */
export const RETRY_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480, 480];
export const GIVE_UP_HOURS = 24;
/** Failed deliveries in a row that switch an endpoint off (its owner is emailed). */
export const DISABLE_AFTER = 15;

/** When to try again after a failed attempt (attempts made so far), or null to give up. */
export function nextAttempt(attempts: number, createdAt: Date, now = new Date()): Date | null {
  const wait = RETRY_MINUTES[attempts - 1];
  if (wait === undefined) return null;
  const at = new Date(now.getTime() + wait * 60_000);
  return at.getTime() - createdAt.getTime() > GIVE_UP_HOURS * 3_600_000 ? null : at;
}

/** True for addresses webhooks must never reach: loopback, private, link-local, carrier NAT, multicast, metadata. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    /^fe[89ab]/.test(v6) ||
    v6.startsWith("ff") ||
    v6.startsWith("64:ff9b:") ||
    v6.startsWith("2001:db8")
  );
}

/** Why a URL can't receive webhooks, or null when it can (its address is checked again on every delivery). */
export function urlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, like https://example.com/hooks/everyops.";
  }
  if (url.protocol !== "https:") return "Webhook URLs must use https://.";
  if (url.username || url.password)
    return "Put credentials in the path or a query token, not the URL's user:password.";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    isPrivateAddress(host)
  )
    return "That address is private or internal. Use a public https:// URL.";
  if (raw.length > 2000) return "That URL is too long.";
  return null;
}
