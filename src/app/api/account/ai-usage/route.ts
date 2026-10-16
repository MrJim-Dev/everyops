import { aiRequestsUsed } from "@/server/ai/rate-limit";
import { isPeriod, usageReport } from "@/server/ai/usage-report";
import { apiUser } from "@/server/session-api";

/**
 * Everything the signed-in account used AI for in the period (?period=month|30d|last-month): in each workspace, in
 * setup before a workspace exists, and through voice input. The basis for per-account limits.
 */
export async function GET(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const asked = new URL(request.url).searchParams.get("period");
  const period = isPeriod(asked) ? asked : "month";
  const [mine, report] = await Promise.all([
    aiRequestsUsed(user.id),
    usageReport({ userId: user.id }, period, { viewer: user.id }),
  ]);
  return Response.json({ ok: true, mine, report });
}
