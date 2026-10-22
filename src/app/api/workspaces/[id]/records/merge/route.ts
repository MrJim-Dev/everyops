import { canEdit } from "@/lib/store/workspace-model";
import { jsonResponse } from "@/server/json-response";
import { writeRecord } from "@/server/record-writes";
import { apiUser } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

/**
 * Merges one record into another of the same type ({ keepId, dropId }): the kept one fills its empty fields from the
 * other, every link moves to it, and the other is removed (src/lib/engine/duplicates.ts). On the server, over every
 * record, so a player's older bookings move even when the browser has only recent ones.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/records/merge">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  const access = await roleIn(id, user.id);
  if (!access) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  if (!canEdit(access.role))
    return Response.json({ ok: false, message: "You have view-only access." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { keepId?: unknown; dropId?: unknown } | null;
  const keepId = typeof body?.keepId === "string" ? body.keepId : "";
  const dropId = typeof body?.dropId === "string" ? body.dropId : "";
  if (!keepId || !dropId)
    return Response.json({ ok: false, message: "Send keepId and dropId." }, { status: 400 });
  const done = await writeRecord(
    id,
    { type: "person", id: user.id, name: user.name, userId: user.id },
    { kind: "merge", id: keepId, dropId },
  );
  if (!done.ok) return Response.json({ ok: false, message: done.message }, { status: done.status });
  return jsonResponse(request, { ok: true, record: done.record, rev: done.rev, notices: done.notices });
}
