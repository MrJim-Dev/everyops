"use client";

export type CheckoutBody =
  | { kind: "plan"; plan: string; period: "monthly" | "yearly" }
  | { kind: "credits"; pack: string };

export type CheckoutAnswer =
  | { ok: true; mode: "redirect"; url: string }
  | { ok: true; mode: "manual"; message: string }
  | { ok: false; message: string };

/** Asks for an upgrade or credits. Goes to the provider's checkout when there is one; else the team is told. */
export async function requestCheckout(body: CheckoutBody): Promise<CheckoutAnswer> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const answer = (await res?.json().catch(() => null)) as CheckoutAnswer | null;
  if (!answer) return { ok: false, message: "Couldn't reach EveryOps. Try again." };
  if (answer.ok && answer.mode === "redirect") window.location.assign(answer.url);
  return answer;
}
