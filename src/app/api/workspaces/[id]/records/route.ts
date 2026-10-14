import { db } from "@/server/db";
import { apiUser } from "@/server/session-api";
import { recordChangesSince } from "@/server/workspace-data";
import { roleIn } from "@/server/workspaces";

/**
 * Records written or deleted since `?since=` (server time from the last read), so an open tab picks up public
 * bookings and teammates' edits without reloading the workspace.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/records">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const since = new URL(request.url).searchParams.get("since") ?? "";
  return Response.json({ ok: true, ...(await recordChangesSince(db, id, since)) });
}
