import { auth } from "@/server/auth";
import { sameOrigin } from "@/server/session-api";
import { approveWaitlisted, isSiteAdmin, listWaitlist, readApprovalToken } from "@/server/waitlist-admin";

/** Everyone on the waitlist, for site admins (SITE_ADMIN_EMAILS). */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!isSiteAdmin(session?.user.email))
    return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  return Response.json({ ok: true, entries: await listWaitlist() });
}

/**
 * Approves one person: { email } from a signed-in site admin, or { token } from the approve link in the admins'
 * email (signed, 30 days). They're emailed a link to create their account.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { email?: unknown; token?: unknown } | null;
  let email: string | null = null;
  if (typeof body?.token === "string") {
    email = readApprovalToken(body.token);
    if (!email)
      return Response.json(
        {
          ok: false,
          message: "This approve link has expired or isn't valid. Approve from the waitlist page.",
        },
        { status: 400 },
      );
  } else if (typeof body?.email === "string") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!isSiteAdmin(session?.user.email))
      return Response.json({ ok: false, message: "Not found." }, { status: 404 });
    email = body.email;
  }
  if (!email) return Response.json({ ok: false, message: "Send an email or a token." }, { status: 400 });
  const done = await approveWaitlisted(email);
  if (!done.ok) return Response.json({ ok: false, message: "They're not on the waitlist." }, { status: 404 });
  return Response.json({ ok: true, email, already: done.already, emailed: done.emailed });
}
