import "server-only";
import { auth } from "./auth";

/** The signed-in user for an API request, or a 401 response to return. */
export async function apiUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return {
      user: null,
      error: Response.json({ ok: false, message: "Sign in first." }, { status: 401 }),
    } as const;
  return { user: session.user, error: null } as const;
}

/** Same-origin check for state-changing requests (the cookie is SameSite=Lax, this adds a second guard). */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  } catch {
    return false;
  }
}
