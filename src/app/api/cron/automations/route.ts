import { timingSafeEqual } from "node:crypto";
import { deliverPending, runTimedAutomations } from "@/server/automations";

/**
 * Called every 15 minutes by Cloud Scheduler with "Authorization: Bearer $CRON_SECRET": runs schedules and dates
 * that are due, sends their emails, then retries emails still pending from saves and bookings.
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
  const result = {
    ok: true,
    workspaces: timed.workspaces,
    runs: timed.runs,
    sent: fresh.sent + retried.sent,
    failed: fresh.failed + retried.failed,
  };
  console.info(JSON.stringify({ event: "automations", ...result }));
  return Response.json(result);
}
