import type {
  Block,
  BlockItem,
  Blueprint,
  Entity,
  Field,
  FormView,
  LandingView,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";

/**
 * EveryOps's standard public site. Every business gets the same sections in the same order, built from its
 * data; the AI only writes the words (SiteCopy). Sections with nothing to show are left out.
 *
 *   Hero → Highlights → What we offer → How it works → Payment methods → FAQ → Contact
 */
export type SiteCopy = {
  /** The hero's big line, a few words. Defaults to the business name. */
  headline?: string;
  /** One or two sentences under it. */
  intro?: string;
  /** The hero button, e.g. Book a court. */
  cta?: string;
  /** Three short reasons to choose the business. */
  highlights?: BlockItem[];
  /** How booking or ordering works, three steps. */
  steps?: BlockItem[];
  /** Heading over the cards of what's offered, e.g. Our courts. */
  offerTitle?: string;
  contact?: { phone?: string; email?: string; address?: string; hours?: string };
};

const PEOPLE =
  /player|client|customer|member|guest|staff|employee|people|person|team|contact|supplier|student|patient|stylist|barber|therapist|doctor|dentist|trainer|coach|instructor|tutor|technician|driver|agent|teacher|artist|groomer/i;
/** Lists that sort what is offered (unit types, service categories) rather than being it. */
const GROUPING = /categor|(^|_|\s)types?($|_|\s)|group|\btags?\b|kinds?$|class(es)?_?type/i;
const PRIVATE_FIELD = /phone|e-?mail|contact|cost|internal|note|stock|quantity|qty|supplier|margin|password/i;
const PAYMENT = /payment.?(method|option|channel)|pay.?method|ways? to pay/i;
const FAQ = /faq|question/i;

const words = (e: Entity) => `${e.id} ${e.name} ${e.pluralName}`;

/** The public form the hero button opens: the booking form if there is one. */
export function mainForm(bp: Blueprint): FormView | undefined {
  const forms = bp.views.filter((v): v is FormView => v.type === "form" && v.public === true);
  return forms.find((f) => bp.entities.find((e) => e.id === f.entityId)?.booking) ?? forms[0];
}

/** The record type a booking is for (the court, the room, the stylist), when it has one. */
export function resourceOf(bp: Blueprint, booking: Entity | undefined): Entity | undefined {
  const field = booking?.booking && booking.fields.find((f) => f.id === booking.booking?.resourceFieldId);
  return field?.relation ? bp.entities.find((e) => e.id === field.relation?.entityId) : undefined;
}

const OFFER_WORDS =
  /product|item|menu|service|package|room|unit|court|rental|class|course|tour|plan|property|villa|space|studio|equipment|vehicle|treatment/i;

/**
 * What the business offers, for the website cards and its Book button: the thing people book (courts, rooms) unless
 * that is a person (a salon books stylists, but sells services), else the list that reads most like an offer: named
 * like one, with prices, pictures and descriptions. Never people, payment methods, FAQs or a list that only groups
 * the offer (unit types, service categories).
 */
export function offeringOf(bp: Blueprint): Entity | undefined {
  const eligible = (e: Entity) =>
    !e.parent &&
    !e.booking &&
    !PEOPLE.test(words(e)) &&
    !PAYMENT.test(words(e)) &&
    !FAQ.test(words(e)) &&
    !GROUPING.test(`${e.id} ${e.name}`);
  const booked = new Set(
    bp.entities.flatMap((e) => (e.booking ? [resourceOf(bp, e)?.id] : [])).filter((id): id is string => !!id),
  );
  // What bookings and their lines link to: a salon appointment's service, a stay's unit.
  const linked = new Set(
    bp.entities
      .filter((e) => e.booking || bp.entities.some((p) => p.booking && e.parent?.entityId === p.id))
      .flatMap((e) => e.fields.map((f) => f.relation?.entityId))
      .filter((id): id is string => !!id),
  );
  const score = (e: Entity) => {
    const money = e.fields.filter(
      (f) => f.type === "money" || (f.type === "formula" && f.formula?.resultType === "money"),
    );
    return (
      (booked.has(e.id) ? 4 : 0) +
      (e.resource ? 3 : 0) +
      (linked.has(e.id) ? 2 : 0) +
      (OFFER_WORDS.test(words(e)) ? 2 : 0) +
      Math.min(money.length, 2) +
      (e.fields.some((f) => f.type === "image") ? 1 : 0) +
      (e.fields.some((f) => f.type === "long_text") ? 1 : 0)
    );
  };
  let best: Entity | undefined;
  for (const e of bp.entities.filter(eligible))
    if (score(e) >= 3 && (!best || score(e) > score(best))) best = e;
  return best;
}

export const paymentsOf = (bp: Blueprint) => bp.entities.find((e) => PAYMENT.test(words(e)));

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");

/**
 * What a button to a public form says: "Book a court" for bookings of a thing, "Book an appointment" when the booking
 * is with a person (a stylist, a dentist), otherwise the form's name.
 */
export function bookLabel(bp: Blueprint, formId: string): string {
  const form = bp.views.find((v) => v.id === formId);
  const entity = form && bp.entities.find((e) => e.id === form.entityId);
  if (entity?.booking) {
    const resource = resourceOf(bp, entity);
    const thing =
      resource && !PEOPLE.test(words(resource)) && !GROUPING.test(resource.id) ? resource.name : entity.name;
    return `Book ${article(thing)} ${thing.toLowerCase()}`;
  }
  return form && form.name.length <= 24 ? form.name : "Book now";
}

const COMMON = new Set(
  "book booking reserve reservation order request schedule your now today online here get start make send see view our the and for with you".split(
    " ",
  ),
);

/**
 * Whether AI-written copy fits this business: every word it names is somewhere in the workspace. Gemini sometimes
 * copies an example from its prompt ("Book a court" on a salon); that falls back to words built from the data.
 */
export function fitsBusiness(bp: Blueprint, text: string | undefined): boolean {
  if (!text) return false;
  // Only the names the workspace is built from: record types, their fields and options. Words in views or other copy
  // can carry the same copied example.
  const known = bp.entities
    .flatMap((e) => [
      bp.workspaceName,
      e.id,
      e.name,
      e.pluralName,
      ...e.fields.flatMap((f) => [f.id, f.name, ...(f.options ?? []).map((o) => o.label)]),
    ])
    .join(" ")
    .toLowerCase();
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? [])
    .filter((w) => !COMMON.has(w))
    .every((w) => known.includes(w.replace(/(ies|es|s)$/, "")));
}
const faqsOf = (bp: Blueprint) => bp.entities.find((e) => FAQ.test(words(e)));

/** Only records a visitor should see: the "active" or "available" ones when the type has such a status. */
export function liveFilter(e: Entity): string | undefined {
  for (const f of e.fields) {
    if (f.type === "status" || f.type === "select") {
      const on = f.options?.find((o) => /^(active|available|open|published|in.?stock)$/i.test(o.id));
      if (on) return `${f.id} == '${on.id}'`;
    }
    if (f.type === "checkbox" && /^(published|active|available|visible)$/i.test(f.id)) return f.id;
  }
  return undefined;
}

/** The fields a card shows: the name, then a picture, a category, up to two prices, a duration and a description. */
function cardFields(e: Entity, extra: (f: Field) => boolean = () => false): string[] {
  const usable = (f: Field) => f.id !== e.primaryFieldId && !PRIVATE_FIELD.test(`${f.id} ${f.name}`);
  const pick = (test: (f: Field) => boolean) => e.fields.find((f) => usable(f) && test(f))?.id;
  const prices = e.fields
    .filter(
      (f) => usable(f) && (f.type === "money" || (f.type === "formula" && f.formula?.resultType === "money")),
    )
    .slice(0, 2)
    .map((f) => f.id);
  return [
    e.primaryFieldId,
    pick((f) => f.type === "image"),
    pick((f) => f.type === "select"),
    ...prices,
    pick(
      (f) =>
        f.type === "number" &&
        /duration|minutes|mins|hours|capacity|guests|pax|sleeps/i.test(`${f.id} ${f.name}`),
    ),
    pick((f) => f.type === "long_text"),
    ...e.fields.filter((f) => usable(f) && extra(f)).map((f) => f.id),
  ].filter((id, i, all): id is string => !!id && all.indexOf(id) === i);
}

/** Copy that's true for any business with this data, for sites the AI hasn't written words for. */
export function defaultCopy(bp: Blueprint, name: string): SiteCopy {
  const form = mainForm(bp);
  const entity = form && bp.entities.find((e) => e.id === form.entityId);
  const offer = offeringOf(bp);
  const booking = !!entity?.booking;
  const thing = offer?.name.toLowerCase() ?? "time";
  const things = offer?.pluralName.toLowerCase();
  return {
    headline: name,
    intro: booking
      ? `Pick a ${thing} and a time that suits you, book in a minute, and ${name} confirms it.`
      : form
        ? things
          ? `See our ${things}, send your request online, and ${name} gets back to you with the details.`
          : `Send your request online and ${name} gets back to you with the details.`
        : undefined,
    steps: !form
      ? undefined
      : booking
        ? [
            {
              title: `Pick a ${thing} and time`,
              body: "See what's free and choose the slot that suits you.",
            },
            { title: "Add your details", body: "Leave your name and number so we can reach you." },
            { title: "Get confirmed", body: `${name} confirms your booking and sends you the details.` },
          ]
        : [
            { title: "Fill in the form", body: "Tell us what you need. It takes a minute." },
            { title: "We review it", body: `${name} checks your request and the details.` },
            { title: "We get back to you", body: "You'll hear from us by phone or message." },
          ],
  };
}

const clean = (text: string | undefined, max: number) => {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).trim();
};

/**
 * An intro in whole sentences: past `max` it keeps the complete sentences that fit, so a run-on (an AI answer that
 * looped, "…formats available now directly web based booking systems format option list") is dropped instead of
 * cut mid-thought. A single long sentence still falls back to a cut at a word.
 */
export function cleanIntro(text: string | undefined, max = 200): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  if (t.length <= max) return t;
  let kept = "";
  for (const sentence of t.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? []) {
    const next = `${kept} ${sentence.trim()}`.trim();
    if (next.length > max) break;
    kept = next;
  }
  return kept || clean(t, max);
}
const cleanItems = (items: BlockItem[] | undefined) =>
  (items ?? [])
    .map((i) => ({ title: clean(i.title, 48) ?? "", body: clean(i.body, 160) ?? "" }))
    .filter((i) => i.title)
    .slice(0, 4);

/** The standard site's blocks for a business, from its data and its copy (missing copy falls back to defaults). */
export function standardBlocks(bp: Blueprint, name: string, copy: SiteCopy = {}): Block[] {
  return keepValidBlocks(bp, buildBlocks(bp, name, copy));
}

/** Blocks that pass the same checks as any page, so a section the data can't support is left out. */
export function keepValidBlocks(bp: Blueprint, blocks: Block[]): Block[] {
  const probe: Blueprint = {
    ...bp,
    views: [...bp.views, { id: "__site_probe", entityId: "", name: "", type: "landing", blocks }],
  };
  const at = new RegExp(`^views\\.${probe.views.length - 1}\\.blocks\\.(\\d+)`);
  const bad = new Set(
    validateBlueprint(probe).flatMap((e) => {
      const m = at.exec(e.path);
      return m ? [Number(m[1])] : [];
    }),
  );
  return blocks.filter((_, i) => !bad.has(i));
}

function buildBlocks(bp: Blueprint, name: string, copy: SiteCopy): Block[] {
  const base = defaultCopy(bp, name);
  const form = mainForm(bp);
  const offer = offeringOf(bp);
  const payments = paymentsOf(bp);
  const faqs = faqsOf(bp);
  const blocks: Block[] = [
    {
      id: "hero",
      type: "hero",
      heading: clean(copy.headline, 60) ?? base.headline ?? name,
      ...(cleanIntro(copy.intro ?? base.intro) ? { subheading: cleanIntro(copy.intro ?? base.intro) } : {}),
      ...(form
        ? {
            ctaViewId: form.id,
            ctaLabel: (fitsBusiness(bp, copy.cta) && clean(copy.cta, 28)) || bookLabel(bp, form.id),
          }
        : {}),
    },
  ];
  const highlights = cleanItems(copy.highlights);
  if (highlights.length >= 2) blocks.push({ id: "highlights", type: "highlights", items: highlights });
  if (offer) {
    const filter = liveFilter(offer);
    blocks.push({
      id: "offer",
      type: "records",
      title: clean(copy.offerTitle, 48) ?? `Our ${offer.pluralName.toLowerCase()}`,
      entityId: offer.id,
      fieldIds: cardFields(offer),
      layout: "cards",
      ...(filter ? { filter } : {}),
      limit: 12,
    });
  }
  const steps = cleanItems(copy.steps?.length ? copy.steps : base.steps);
  if (steps.length >= 2) blocks.push({ id: "steps", type: "steps", title: "How it works", items: steps });
  if (payments) {
    const filter = liveFilter(payments);
    blocks.push({
      id: "payments",
      type: "records",
      title: "Ways to pay",
      entityId: payments.id,
      fieldIds: cardFields(payments, (f) => f.type === "text" && /account|number/i.test(`${f.id} ${f.name}`)),
      layout: "cards",
      ...(filter ? { filter } : {}),
    });
  }
  if (faqs) {
    const answer = faqs.fields.find((f) => f.type === "long_text");
    const order = faqs.fields.find((f) => f.type === "number");
    const filter = liveFilter(faqs);
    if (answer)
      blocks.push({
        id: "faq",
        type: "records",
        title: "Questions",
        entityId: faqs.id,
        fieldIds: [faqs.primaryFieldId, answer.id],
        layout: "faq",
        ...(filter ? { filter } : {}),
        ...(order ? { sort: [{ fieldId: order.id, dir: "asc" as const }] } : {}),
      });
  }
  const contact = copy.contact ?? {};
  const details = {
    phone: clean(contact.phone, 40),
    email: clean(contact.email, 80),
    address: clean(contact.address, 160),
    hours: clean(contact.hours, 120),
  };
  if (Object.values(details).some(Boolean))
    blocks.push({
      id: "contact",
      type: "contact",
      title: "Visit or reach us",
      ...Object.fromEntries(Object.entries(details).filter(([, v]) => v)),
    });
  return blocks;
}

/** A complete standard landing page view. */
export function standardLanding(bp: Blueprint, name: string, copy: SiteCopy = {}, id = "home"): LandingView {
  return {
    id,
    entityId: "",
    name: "Home",
    type: "landing",
    public: true,
    layout: "standard",
    blocks: standardBlocks(bp, name, copy),
  };
}

/** Copy that's already on a page, so switching an older page to the standard layout keeps its words. */
export function copyFromBlocks(blocks: Block[]): SiteCopy {
  const hero = blocks.find((b) => b.type === "hero");
  const highlights = blocks.find((b) => b.type === "highlights");
  const steps = blocks.find((b) => b.type === "steps");
  const contact = blocks.find((b) => b.type === "contact");
  return {
    ...(hero?.type === "hero" ? { headline: hero.heading, intro: hero.subheading, cta: hero.ctaLabel } : {}),
    ...(highlights?.type === "highlights" ? { highlights: highlights.items } : {}),
    ...(steps?.type === "steps" ? { steps: steps.items } : {}),
    ...(contact?.type === "contact"
      ? {
          contact: {
            phone: contact.phone,
            email: contact.email,
            address: contact.address,
            hours: contact.hours,
          },
        }
      : {}),
  };
}
