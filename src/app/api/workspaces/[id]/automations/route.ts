import { deliverPending, listRuns, runTimedAutomations } from "@/server/automations";
import { apiUser } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

/** Recent automation runs: what each automation did, on which record, and whether its emails went. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/automations">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  return Response.json({ ok: true, runs: await listRuns(id) });
}

/** Run now: owners and admins run a timed automation straight away, for every record it applies to today. */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/automations">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  const access = await roleIn(id, user.id);
  if (!access) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  if (access.role !== "owner" && access.role !== "admin")
    return Response.json(
      { ok: false, message: "Only owners and admins can run automations." },
      { status: 403 },
    );
  const body = (await request.json().catch(() => ({}))) as { ruleId?: unknown };
  if (typeof body.ruleId !== "string" || !body.ruleId)
    return Response.json({ ok: false, message: "Say which automation to run." }, { status: 400 });
  const timed = await runTimedAutomations(new Date(), { workspaceId: id, ruleId: body.ruleId, force: true });
  await deliverPending(timed.pending);
  return Response.json({ ok: true, runs: timed.runs });
}
