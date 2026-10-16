import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { APP_DOMAIN, routeCustomHost } from "@/lib/domains";
import { lookupHost, primaryDomain } from "@/server/domains";

/** Hosts that are EveryOps itself: the app, its Cloud Run address and local development. */
function ownHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === APP_DOMAIN || host === `www.${APP_DOMAIN}`)
    return true;
  if (host.endsWith(".run.app")) return true;
  const configured = [
    process.env.BETTER_AUTH_URL,
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(","),
  ]
    .map((u) => {
      try {
        return u ? new URL(u.trim()).hostname : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return configured.includes(host);
}

/** The private pages the session gate covers (it only checks the cookie exists; pages validate the session). */
const PRIVATE = /^\/(workspaces|account|w)(\/|$)/;

const notFound = () =>
  new NextResponse(
    '<!doctype html><meta name="viewport" content="width=device-width"><title>Not found</title><body style="font:16px system-ui,sans-serif;padding:72px 24px;text-align:center;color:#333"><h1 style="font-size:22px">This page doesn\'t exist</h1><p style="color:#777">Nothing is published at this address.</p></body>',
    {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );

/**
 * Every request starts here. On EveryOps' own hosts: no session cookie on a private page means sign-in, signed-out
 * visitors see the landing page at "/", and a workspace's old /s/<workspace> address moves to its primary custom
 * domain once that's live. On a custom domain: only that workspace's public
 * pages, at clean paths; anything else, and any host nobody has claimed, is a plain 404.
 */
export async function proxy(request: NextRequest) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();
  const path = request.nextUrl.pathname;
  if (ownHost(host)) {
    const old = /^\/s\/([^/]+)(\/.*)?$/.exec(path);
    if (old && request.method === "GET") {
      const domain = await primaryDomain(old[1]).catch(() => null);
      if (domain) {
        // Local *.localhost domains keep http and the dev server's port; real ones are always https.
        const url = request.nextUrl.clone();
        url.hostname = domain;
        url.pathname = old[2] ?? "/";
        if (!domain.endsWith(".localhost")) {
          url.protocol = "https:";
          url.port = "";
        }
        return NextResponse.redirect(url, 308);
      }
    }
    if (getSessionCookie(request) || !(path === "/" || PRIVATE.test(path))) return NextResponse.next();
    if (path === "/") return NextResponse.rewrite(new URL("/welcome", request.url));
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  const domain = await lookupHost(host).catch(() => null);
  if (!domain) return notFound();
  const route = routeCustomHost(path, domain);
  if (route.kind === "pass") return NextResponse.next();
  if (route.kind === "notFound") return notFound();
  if (route.kind === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = route.to;
    return NextResponse.redirect(url, 308);
  }
  // Pages render their links for the domain they're on.
  const headers = new Headers(request.headers);
  headers.set("x-everyops-domain", host);
  const url = request.nextUrl.clone();
  url.pathname = route.to;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  // Everything but build assets: custom domains route every path.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
