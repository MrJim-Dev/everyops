import { canManage } from "@/lib/store/workspace-model";
import { aiRequestsUsed } from "@/server/ai/rate-limit";
import { usageOf } from "@/server/ai/usage";
import { isPeriod, usageReport } from "@/server/ai/usage-report";
import { apiUser } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

/**
 * This workspace's AI use: the month's total against its budget, how much of the caller's own limit is used now,
 * and the breakdown of every call in the period (?period=month|30d|last-month). Owners and admins see it per person
 * and everyone's latest calls; other members see the totals and their own calls.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/ai-usage">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  const access = await roleIn(id, user.id);
  if (!access) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const asked = new URL(request.url).searchParams.get("period");
  const period = isPeriod(asked) ? asked : "month";
  const [usage, mine, report] = await Promise.all([
    usageOf(id),
    aiRequestsUsed(user.id),
    usageReport({ workspaceId: id }, period, { viewer: user.id, people: canManage(access.role) }),
  ]);
  return Response.json({ ok: true, usage, mine, report });
}
