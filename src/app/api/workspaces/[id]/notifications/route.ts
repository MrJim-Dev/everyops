import { listNotifications, markRead } from "@/server/notifications";
import { apiUser } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

/** The signed-in person's notifications in this workspace (newest 30) and how many are unread. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/notifications">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  return Response.json({ ok: true, ...(await listNotifications(id, user.id)) });
}

/** Marks notifications read: { ids: [...] } for some, or {} for all of them. */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/notifications">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 200)
    : undefined;
  await markRead(id, user.id, ids);
  return Response.json({ ok: true });
}
