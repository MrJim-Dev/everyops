import { z } from "zod";
import { PLAN_IDS } from "@/lib/billing/plans";
import { auth } from "@/server/auth";
import { listAccounts, spendOverview, updateAccount } from "@/server/billing/account";
import { sameOrigin } from "@/server/session-api";
import { isSiteAdmin } from "@/server/waitlist-admin";

async function admin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return isSiteAdmin(session?.user.email) ? (session?.user.email ?? null) : null;
}
const notFound = () => Response.json({ ok: false, message: "Not found." }, { status: 404 });

/** Every account with its plan and use, plus today's AI spending, for site admins. */
export async function GET(request: Request) {
  if (!(await admin(request))) return notFound();
  const [accounts, spend] = await Promise.all([listAccounts(), spendOverview()]);
  return Response.json({ ok: true, accounts, spend });
}

const change = z.object({
  userId: z.string().min(1),
  plan: z.enum(PLAN_IDS as [string, ...string[]]).optional(),
  grantCredits: z.number().int().min(0).max(1_000_000).optional(),
  suspend: z.string().trim().max(300).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/** A site admin assigns a plan, grants credits for this month, suspends or lifts a suspension, or notes something. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const by = await admin(request);
  if (!by) return notFound();
  const parsed = change.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "Check the change and try again." }, { status: 400 });
  const { userId, ...rest } = parsed.data;
  const done = await updateAccount(by, userId, rest as Parameters<typeof updateAccount>[2]);
  if (!done.ok) return Response.json(done, { status: 400 });
  return Response.json({ ok: true });
}
