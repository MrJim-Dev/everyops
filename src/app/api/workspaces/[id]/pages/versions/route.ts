import { db } from "@/server/db";
import { apiUser } from "@/server/session-api";
import { pageVersionBody, pageVersions } from "@/server/workspace-data";
import { roleIn } from "@/server/workspaces";

/**
 * A page's earlier versions (?key=PAGE), or one version's text (&version=ID), for anyone on the workspace's team.
 * Restoring is an ordinary save of that text from the editor, so it is itself kept and can be undone.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/pages/versions">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const url = new URL(request.url);
  const key = (url.searchParams.get("key") ?? "").slice(0, 200);
  if (!key) return Response.json({ ok: false, message: "Say which page." }, { status: 400 });
  const version = Number(url.searchParams.get("version"));
  if (version) {
    const body = await pageVersionBody(db, id, key, version);
    return body === null
      ? Response.json({ ok: false, message: "That version is gone." }, { status: 404 })
      : Response.json({ ok: true, body });
  }
  return Response.json({ ok: true, versions: await pageVersions(db, id, key) });
}
