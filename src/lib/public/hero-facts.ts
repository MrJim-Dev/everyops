import { displayKind } from "@/lib/blueprint/field-kind";
import { optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, Field } from "@/lib/blueprint/types";
import { applyFilter } from "@/lib/engine/query";
import { currencyOf, formatMoney } from "@/lib/format";
import { liveFilter, offeringOf, paymentsOf } from "./site-template";

/** A fact a visitor wants before booking, shown under the hero's buttons. Built only from public-safe data. */
export type HeroFact = { kind: "offer" | "hours" | "price" | "pay"; text: string };

/** "06:00" → "6 AM", "13:30" → "1:30 PM", "24:00" → "midnight". */
export function clockLabel(hhmm: string): string {
  const [h, m = 0] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  if (h % 24 === 0 && !m) return h ? "midnight" : "12 AM";
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h % 24 < 12 ? "AM" : "PM"}`;
}

const UNITS: [RegExp, string][] = [
  [/hour|hourly|\bhr\b/i, "an hour"],
  [/night|nightly/i, "a night"],
  [/day|daily/i, "a day"],
  [/week|weekly/i, "a week"],
  [/month|monthly/i, "a month"],
  [/person|head|pax/i, "a person"],
];
const unitOf = (field: Field) => UNITS.find(([re]) => re.test(`${field.id} ${field.name}`))?.[1];
const PRIVATE_PRICE = /cost|margin|regular|wholesale|internal/i;

/** The lowest price a visitor would pay: the offering's own price, or a flat rate on the booking that uses it. */
function startingPrice(bp: Blueprint, offer: Entity, live: DataRecord[]): string | undefined {
  const own = offer.fields.find(
    (f) => displayKind(bp, f) === "money" && !PRIVATE_PRICE.test(`${f.id} ${f.name}`),
  );
  if (own) {
    const prices = live.map((r) => Number(r.data[own.id])).filter((n) => Number.isFinite(n) && n > 0);
    if (prices.length) {
      const unit = unitOf(own);
      return `From ${formatMoney(Math.min(...prices), { currency: currencyOf(bp) })}${unit ? ` ${unit}` : ""}`;
    }
  }
  // Court bookings price the booking, not the court: "Rate per hour" = 400.
  for (const booking of bp.entities) {
    const resource = booking.booking && booking.fields.find((f) => f.id === booking.booking?.resourceFieldId);
    if (resource?.relation?.entityId !== offer.id) continue;
    const rate = booking.fields.find(
      (f) =>
        f.type === "formula" &&
        f.formula?.resultType === "money" &&
        /^\s*\d+(\.\d+)?\s*$/.test(f.formula.expr),
    );
    const amount = rate?.formula ? Number(rate.formula.expr) : Number.NaN;
    if (rate && amount > 0) {
      const unit = unitOf(rate);
      return `From ${formatMoney(amount, { currency: currencyOf(bp) })}${unit ? ` ${unit}` : ""}`;
    }
  }
  return undefined;
}

/** "Pay with GCash or Maya", from the payment methods that are switched on. */
function paymentLine(bp: Blueprint, records: DataRecord[], now: Date): string | undefined {
  const methods = paymentsOf(bp);
  if (!methods) return undefined;
  const kind = methods.fields.find((f) => f.type === "select");
  const names = [
    ...new Set(
      applyFilter(bp, methods, records, liveFilter(methods), now)
        .map((r) => (kind ? optionOf(kind, r.data[kind.id])?.label : undefined) ?? recordTitle(methods, r))
        .filter((n): n is string => !!n && n.length <= 24),
    ),
  ].slice(0, 3);
  if (!names.length) return undefined;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  return `Pay with ${list}`;
}

/** Up to four facts for the hero: how many there are to book, opening hours, the starting price and how to pay. */
export function heroFacts(bp: Blueprint, records: DataRecord[], now = new Date()): HeroFact[] {
  const facts: HeroFact[] = [];
  const offer = offeringOf(bp);
  if (offer) {
    const live = applyFilter(bp, offer, records, liveFilter(offer), now);
    if (live.length > 1)
      facts.push({ kind: "offer", text: `${live.length} ${offer.pluralName.toLowerCase()}` });
    if (offer.resource)
      facts.push({
        kind: "hours",
        text: `Open ${clockLabel(offer.resource.opensAt)} to ${clockLabel(offer.resource.closesAt)}`,
      });
    const price = startingPrice(bp, offer, live);
    if (price) facts.push({ kind: "price", text: price });
  }
  const pay = paymentLine(bp, records, now);
  if (pay) facts.push({ kind: "pay", text: pay });
  return facts.slice(0, 4);
}
