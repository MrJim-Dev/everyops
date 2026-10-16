import { revokeKey } from "@/server/api-keys";
import { apiUser, sameOrigin } from "@/server/session-api";

/** Revokes a key: it stops working on the next request. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/keys/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const done = await revokeKey(user.id, (await params).id);
  return done
    ? Response.json({ ok: true })
    : Response.json({ ok: false, message: "That key isn't active." }, { status: 404 });
}
