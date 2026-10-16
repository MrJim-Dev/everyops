import { z } from "zod";
import { canManage } from "@/lib/store/workspace-model";
import { closeRequest, openRequests } from "@/server/agent-requests";
import { apiUser, sameOrigin } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

async function manager(request: Request, id: string) {
  const { user, error } = await apiUser(request);
  if (error) return { error };
  const access = await roleIn(id, user.id);
  if (!access)
    return { error: Response.json({ ok: false, message: "Workspace not found." }, { status: 404 }) };
  if (!canManage(access.role))
    return { error: Response.json({ ok: false, message: "Owners and admins only." }, { status: 403 }) };
  return { error: null };
}

/** Design changes AI agents asked for (MCP propose_change), for owners and admins. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/agent-requests">) {
  const { id } = await params;
  const { error } = await manager(request, id);
  if (error) return error;
  return Response.json({ ok: true, requests: await openRequests(id) });
}

const body = z.object({ id: z.number().int(), status: z.enum(["drafted", "dismissed"]) });

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/workspaces/[id]/agent-requests">,
) {
  const { id } = await params;
  const { error } = await manager(request, id);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Bad request." }, { status: 400 });
  const done = await closeRequest(id, parsed.data.id, parsed.data.status);
  return Response.json({ ok: done }, { status: done ? 200 : 404 });
}
