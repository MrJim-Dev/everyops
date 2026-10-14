import { listThreads } from "@/server/assistant-threads";
import { apiUser } from "@/server/session-api";

/** The signed-in person's assistant conversations in one workspace. */
export async function GET(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const threads = await listThreads(workspaceId, user.id);
  if (!threads) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  return Response.json({ ok: true, threads });
}
