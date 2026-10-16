import { timingSafeEqual } from "node:crypto";
import { trimActivity } from "@/server/activity";
import { deliverPending, runTimedAutomations } from "@/server/automations";
import { checkPendingDomains } from "@/server/domains";
import { deliverWebhooks, trimDeliveries } from "@/server/webhooks";

/**
 * Called every 15 minutes by Cloud Scheduler with "Authorization: Bearer $CRON_SECRET": runs schedules and dates
 * that are due, sends their emails, retries emails still pending from saves and bookings, and drops activity
 * log entries past their retention.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const ok =
    !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ ok: false }, { status: 401 });
  const timed = await runTimedAutomations();
  const fresh = await deliverPending(timed.pending);
  const retried = await deliverPending();
  const trimmed = await trimActivity();
  // Webhook retries that are due (fresh deliveries go right after the change that caused them).
  const hooks = await deliverWebhooks(200);
  await trimDeliveries();
  // Custom domains on their way to live: DNS and certificates checked again.
  const domains = await checkPendingDomains();
  const result = {
    ok: true,
    workspaces: timed.workspaces,
    runs: timed.runs,
    sent: fresh.sent + retried.sent,
    failed: fresh.failed + retried.failed,
    activityTrimmed: trimmed,
    webhooksSent: hooks.sent,
    webhooksFailed: hooks.failed,
    domainsChecked: domains,
  };
  console.info(JSON.stringify({ event: "automations", ...result }));
  return Response.json(result);
}
