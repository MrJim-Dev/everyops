import { applyPaymentEvent } from "@/server/billing/account";
import { paymentProvider } from "@/server/billing/provider";

/**
 * Payment provider callbacks (subscription paid, renewed, failed, canceled; credit pack paid). The provider checks
 * the signature in parseWebhook; nothing is applied from an unsigned request. With no provider connected every
 * request is refused.
 */
export async function POST(request: Request) {
  const provider = paymentProvider();
  if (!provider.online)
    return Response.json({ ok: false, message: "No payment provider is connected." }, { status: 501 });
  const event = await provider.parseWebhook(request).catch(() => null);
  if (!event) return Response.json({ ok: false, message: "Not a valid webhook." }, { status: 400 });
  await applyPaymentEvent(provider.id, event);
  return Response.json({ ok: true });
}
