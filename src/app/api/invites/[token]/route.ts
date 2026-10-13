import { apiUser, sameOrigin } from "@/server/session-api";
import { acceptInvite, findInvite } from "@/server/workspaces";

/** Invite details for the accept page. The token itself is the secret. */
export async function GET(request: Request, { params }: RouteContext<"/api/invites/[token]">) {
  const { error } = await apiUser(request);
  if (error) return error;
  const invite = await findInvite((await params).token);
  if (!invite) return Response.json({ ok: false, message: "This invite isn't valid." }, { status: 404 });
  return Response.json({ ok: true, invite });
}

export async function POST(request: Request, { params }: RouteContext<"/api/invites/[token]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const result = await acceptInvite((await params).token, user);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
