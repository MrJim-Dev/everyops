import { z } from "zod";
import { isDemoEmail } from "@/lib/auth/demo";
import { isPlanId, PLANS, packOf } from "@/lib/billing/plans";
import { takeToken } from "@/server/ai/rate-limit";
import { type CheckoutItem, paymentProvider } from "@/server/billing/provider";
import { apiUser, sameOrigin } from "@/server/session-api";

const body = z.union([
  z.object({ kind: z.literal("plan"), plan: z.string(), period: z.enum(["monthly", "yearly"]) }),
  z.object({ kind: z.literal("credits"), pack: z.string() }),
]);

/**
 * Upgrading or buying credits. With a payment provider this answers { mode: "redirect", url } for its hosted
 * checkout; until one is connected it answers { mode: "manual", message } after telling the site admins.
 */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  if (isDemoEmail(user.email))
    return Response.json(
      { ok: false, message: "The shared demo account can't change plans." },
      { status: 403 },
    );
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "Choose a plan or credit pack." }, { status: 400 });
  let item: CheckoutItem;
  if (parsed.data.kind === "plan") {
    const id = parsed.data.plan;
    if (!isPlanId(id) || !PLANS[id].public || !PLANS[id].monthlyCentavos)
      return Response.json({ ok: false, message: "Choose a paid plan." }, { status: 400 });
    item = { kind: "plan", plan: PLANS[id], period: parsed.data.period };
  } else {
    const pack = packOf(parsed.data.pack);
    if (!pack) return Response.json({ ok: false, message: "Choose a credit pack." }, { status: 400 });
    item = { kind: "credits", pack };
  }
  // Each request emails the admins, so a few a day is plenty.
  if (!(await takeToken(`checkout:${user.id}`, 5, 86_400_000)).ok)
    return Response.json(
      { ok: false, message: "We already have your request and will be in touch soon." },
      { status: 429 },
    );
  const result = await paymentProvider().checkout({
    userId: user.id,
    email: user.email,
    name: user.name,
    item,
  });
  return Response.json({ ok: true, ...result });
}
