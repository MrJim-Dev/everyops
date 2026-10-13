import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Fast first gate: no session cookie on a private page means straight to sign-in.
 * The exception is the home page: signed-out visitors see the landing page at "/".
 * It only checks that the cookie exists; pages still validate the session on the server.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  if (request.nextUrl.pathname === "/") return NextResponse.rewrite(new URL("/welcome", request.url));
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/sign-in";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/", "/workspaces", "/account/:path*", "/w/:path*"],
};
