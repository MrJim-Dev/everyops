import { DEMO_LOCKED_MESSAGE, isDemoEmail } from "@/lib/auth/demo";
import { getCommunity, unpublishSystem, updateSystem } from "@/server/community";
import { apiUser, sameOrigin } from "@/server/session-api";
import { publishBody } from "../route";

export async function GET(_request: Request, { params }: RouteContext<"/api/community/[id]">) {
  const system = await getCommunity((await params).id);
  return system ? Response.json({ ok: true, system }) : Response.json({ ok: false }, { status: 404 });
}

export async function PUT(request: Request, { params }: RouteContext<"/api/community/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  if (isDemoEmail(user.email))
    return Response.json({ ok: false, message: DEMO_LOCKED_MESSAGE }, { status: 403 });
  const parsed = publishBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "Check the name and summary." }, { status: 400 });
  const { workspaceId: _w, ...doc } = parsed.data;
  const system = await updateSystem((await params).id, user.id, { ...doc, author: user.name } as never);
  return system
    ? Response.json({ ok: true, system })
    : Response.json({ ok: false, message: "Not found." }, { status: 404 });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/community/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const ok = await unpublishSystem((await params).id, user.id);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
