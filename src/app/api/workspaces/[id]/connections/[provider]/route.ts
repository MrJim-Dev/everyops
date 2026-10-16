import { cookies } from "next/headers";
import { isProvider } from "@/lib/connections";
import { authorizeUrl, disconnect, googleReady, makeState } from "@/server/connections";
import { managerOf } from "@/server/manager-api";

type Ctx = RouteContext<"/api/workspaces/[id]/connections/[provider]">;

/** Starts connecting a service: off to Google's consent screen with a signed state (and its nonce in a cookie). */
export async function GET(request: Request, { params }: Ctx) {
  const { id, provider } = await params;
  const { user, error } = await managerOf(request, id);
  if (error) return error;
  if (!isProvider(provider))
    return Response.json({ ok: false, message: "Unknown service." }, { status: 404 });
  if (!googleReady())
    return Response.json({ ok: false, message: "Google sign-in isn't configured here." }, { status: 503 });
  const state = makeState(id, provider, user.id);
  (await cookies()).set("eo_connect", state.nonce, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/connections",
    maxAge: 600,
  });
  return Response.redirect(authorizeUrl(provider, state.value, user.email), 302);
}

/** Disconnects a service: its tools disappear from Ask EveryOps at once and the tokens are revoked at Google. */
export async function DELETE(request: Request, { params }: Ctx) {
  const { id, provider } = await params;
  const { user, error } = await managerOf(request, id, true);
  if (error) return error;
  if (!isProvider(provider))
    return Response.json({ ok: false, message: "Unknown service." }, { status: 404 });
  return (await disconnect(id, provider, user.id))
    ? Response.json({ ok: true })
    : Response.json({ ok: false, message: "It isn't connected." }, { status: 404 });
}
