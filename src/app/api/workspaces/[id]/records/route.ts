import { canSee, isLimited } from "@/lib/engine/access";
import { viewerOf } from "@/server/access";
import { db } from "@/server/db";
import { jsonResponse } from "@/server/json-response";
import { apiUser } from "@/server/session-api";
import { currentBlueprint, recordChangesSince } from "@/server/workspace-data";
import { roleIn } from "@/server/workspaces";

/**
 * Records written or deleted since `?since=` (server time from the last read), so an open tab picks up public
 * bookings and teammates' edits without reloading the workspace. A member who sees only their own records gets only
 * those; a record that stopped being theirs (reassigned) comes back as deleted, so it leaves their screen.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/records">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  const access = await roleIn(id, user.id);
  if (!access) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const since = new URL(request.url).searchParams.get("since") ?? "";
  const changes = await recordChangesSince(db, id, since);
  const bp = await currentBlueprint(db, id);
  const viewer = await viewerOf(db, user.id, access.role);
  if (!bp || !isLimited(bp, viewer)) return jsonResponse(request, { ok: true, ...changes });
  const hidden = changes.changed.filter((s) => !canSee(bp, viewer, s.record)).map((s) => s.record.id);
  return jsonResponse(request, {
    ok: true,
    ...changes,
    changed: changes.changed.filter((s) => canSee(bp, viewer, s.record)),
    deleted: [...changes.deleted, ...hidden],
  });
}
