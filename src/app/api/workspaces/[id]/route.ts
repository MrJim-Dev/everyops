import { isDemoEmail } from "@/lib/auth/demo";
import type { Workspace } from "@/lib/store/workspace-model";
import { apiUser, sameOrigin } from "@/server/session-api";
import { loadWorkspace, MAX_DOC_BYTES, removeWorkspace, saveWorkspace } from "@/server/workspaces";

/** The latest copy of one workspace, so an open tab can pick up records created elsewhere (public bookings). */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const found = await loadWorkspace((await params).id, user.id);
  if (!found) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const { records, syncedAt, docs } = found.workspace;
  return Response.json({ ok: true, records, docs: docs ?? {}, syncedAt });
}

export async function PUT(request: Request, { params }: RouteContext<"/api/workspaces/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const raw = await request.text();
  if (raw.length > MAX_DOC_BYTES)
    return Response.json({ ok: false, message: "This workspace is too large to save." }, { status: 413 });
  let ws: Workspace;
  try {
    ws = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, message: "Invalid workspace." }, { status: 400 });
  }
  if (
    !ws ||
    ws.slug !== id ||
    !Array.isArray(ws.versions) ||
    !Array.isArray(ws.records) ||
    !ws.versions.length
  )
    return Response.json({ ok: false, message: "Invalid workspace." }, { status: 400 });
  const result = await saveWorkspace(user.id, ws, { demo: isDemoEmail(user.email) });
  return Response.json(result, { status: result.ok ? 200 : result.status });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/workspaces/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const result = await removeWorkspace(user.id, (await params).id);
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
