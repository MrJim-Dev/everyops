import { aiRequestsUsed } from "@/server/ai/rate-limit";
import { usageOf } from "@/server/ai/usage";
import { apiUser } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

/** This workspace's AI use this month (and last), its budget, and how much of the caller's own limit is used now. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/ai-usage">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const [usage, mine] = await Promise.all([usageOf(id), aiRequestsUsed(user.id)]);
  return Response.json({ ok: true, usage, mine });
}
