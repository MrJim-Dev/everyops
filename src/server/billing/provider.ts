import "server-only";
import { sql } from "kysely";
import { type CreditPack, formatPeso, type Plan, yearlyCentavos } from "@/lib/billing/plans";
import { db } from "@/server/db";
import { notifyAdmins } from "./notify";

/**
 * Taking payment. EveryOps has no payment provider yet, so the only one is "manual": asking to upgrade or buy credits
 * records the request and emails the site admins, who assign the plan from /admin/accounts after arranging payment.
 *
 * A real provider (PayMongo for PHP cards and Maya, Paddle for USD) implements PaymentProvider: checkout() returns
 * the hosted checkout URL, and parseWebhook() turns the provider's signed callback into a PaymentEvent that
 * applyPaymentEvent (account.ts) applies. Pick it with PAYMENT_PROVIDER.
 */

export type CheckoutItem =
  | { kind: "plan"; plan: Plan; period: "monthly" | "yearly" }
  | { kind: "credits"; pack: CreditPack };

export type CheckoutRequest = { userId: string; email: string; name: string; item: CheckoutItem };

export type CheckoutResult =
  | { mode: "redirect"; url: string }
  | { mode: "manual"; message: string; requestId: string };

/** What a provider's webhook means for an account, in EveryOps' own terms. */
export type PaymentEvent =
  | { type: "plan.activated"; userId: string; plan: Plan["id"]; periodEnd: string; providerRef: string }
  | { type: "plan.past_due"; userId: string; providerRef: string }
  | { type: "plan.canceled"; userId: string; providerRef: string }
  | { type: "credits.purchased"; userId: string; credits: number; providerRef: string };

export interface PaymentProvider {
  id: string;
  /** Shown on the pricing page: whether people can pay online now. */
  online: boolean;
  checkout(request: CheckoutRequest): Promise<CheckoutResult>;
  /** Reads and verifies a webhook (signature first). Null when it isn't one this provider sent. */
  parseWebhook(request: Request): Promise<PaymentEvent | null>;
}

export const itemLabel = (item: CheckoutItem) =>
  item.kind === "plan"
    ? `${item.plan.name}, ${item.period} (${formatPeso(item.period === "yearly" ? yearlyCentavos(item.plan) : item.plan.monthlyCentavos)}${item.period === "yearly" ? "/year" : "/month"})`
    : `${item.pack.credits.toLocaleString("en-US")} AI credits (${formatPeso(item.pack.centavos)})`;

/** No online payment: record the request, tell the site admins, and tell the person what happens next. */
export const manualProvider: PaymentProvider = {
  id: "manual",
  online: false,
  async checkout({ userId, email, name, item }) {
    const detail =
      item.kind === "plan"
        ? { item: "plan", plan: item.plan.id, period: item.period }
        : { item: "credits", pack: item.pack.id, credits: item.pack.credits };
    const { rows } = await sql<{ id: string }>`
      insert into billing_event (user_id, kind, detail, actor)
      values (${userId}, 'checkout_requested', ${JSON.stringify({ ...detail, provider: "manual" })}::jsonb, ${email})
      returning id`.execute(db);
    await notifyAdmins({
      subject: `${name || email} wants ${item.kind === "plan" ? `the ${item.plan.name} plan` : "more AI credits"}`,
      heading: item.kind === "plan" ? "An upgrade request" : "A credit pack request",
      lines: [
        `${name || email} (${email}) asked for ${itemLabel(item)}.`,
        "Online payment isn't connected yet. Arrange payment with them, then assign it on the accounts page.",
      ],
      action: { label: "Open accounts", path: `/admin/accounts?email=${encodeURIComponent(email)}` },
    });
    return {
      mode: "manual",
      requestId: rows[0]?.id ?? "",
      message:
        "Online payment isn't available yet. We've let the EveryOps team know; they'll email you payment details and switch you over once it's paid.",
    };
  },
  async parseWebhook() {
    return null;
  },
};

/** The provider in use (PAYMENT_PROVIDER). Only "manual" exists until a provider account is approved. */
export function paymentProvider(): PaymentProvider {
  switch (process.env.PAYMENT_PROVIDER) {
    default:
      return manualProvider;
  }
}
