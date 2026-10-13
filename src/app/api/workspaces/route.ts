import { apiUser } from "@/server/session-api";
import { listWorkspaces } from "@/server/workspaces";

export async function GET(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  return Response.json({ ok: true, workspaces: await listWorkspaces(user.id) });
}
