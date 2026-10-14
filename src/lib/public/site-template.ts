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
  /player|client|customer|member|guest|staff|employee|people|person|team|contact|supplier|student|patient/i;
const PRIVATE_FIELD = /phone|e-?mail|contact|cost|internal|note|stock|quantity|qty|supplier|margin|password/i;
const PAYMENT = /payment.?(method|option|channel)|pay.?method|ways? to pay/i;
const FAQ = /faq|question/i;

const words = (e: Entity) => `${e.id} ${e.name} ${e.pluralName}`;

/** The public form the hero button opens: the booking form if there is one. */
export function mainForm(bp: Blueprint): FormView | undefined {
  const forms = bp.views.filter((v): v is FormView => v.type === "form" && v.public === true);
  return forms.find((f) => bp.entities.find((e) => e.id === f.entityId)?.booking) ?? forms[0];
}

/** What the business offers: the thing people book (courts, rooms) or, failing that, its products or services. */
export function offeringOf(bp: Blueprint): Entity | undefined {
  for (const e of bp.entities) {
    const resourceField = e.booking && e.fields.find((f) => f.id === e.booking?.resourceFieldId);
    const target =
      resourceField?.relation && bp.entities.find((x) => x.id === resourceField.relation?.entityId);
    if (target) return target;
  }
  return (
    bp.entities.find((e) => e.resource) ??
    bp.entities.find(
      (e) =>
        !e.parent &&
        !e.booking &&
        !PEOPLE.test(words(e)) &&
        !PAYMENT.test(words(e)) &&
        !FAQ.test(words(e)) &&
        /product|item|menu|service|package|room|unit|court|rental|class|course|tour|plan/i.test(words(e)),
    )
  );
}

const paymentsOf = (bp: Blueprint) => bp.entities.find((e) => PAYMENT.test(words(e)));
const faqsOf = (bp: Blueprint) => bp.entities.find((e) => FAQ.test(words(e)));

/** Only records a visitor should see: the "active" or "available" ones when the type has such a status. */
function liveFilter(e: Entity): string | undefined {
  for (const f of e.fields) {
    if (f.type === "status" || f.type === "select") {
      const on = f.options?.find((o) => /^(active|available|open|published|in.?stock)$/i.test(o.id));
      if (on) return `${f.id} == '${on.id}'`;
    }
    if (f.type === "checkbox" && /^(published|active|available|visible)$/i.test(f.id)) return f.id;
  }
  return undefined;
}

/** The fields a card shows: the name, then a picture, a category, a price and a description. */
function cardFields(e: Entity, extra: (f: Field) => boolean = () => false): string[] {
  const usable = (f: Field) => f.id !== e.primaryFieldId && !PRIVATE_FIELD.test(`${f.id} ${f.name}`);
  const pick = (test: (f: Field) => boolean) => e.fields.find((f) => usable(f) && test(f))?.id;
  return [
    e.primaryFieldId,
    pick((f) => f.type === "image"),
    pick((f) => f.type === "select"),
    pick((f) => f.type === "money" || (f.type === "formula" && f.formula?.resultType === "money")),
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
  return {
    headline: name,
    intro: booking
      ? `Book ${offer ? offer.pluralName.toLowerCase() : "online"} in a few taps and get a confirmation from ${name}.`
      : form
        ? `Send your request online and ${name} will get back to you.`
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
      ...(clean(copy.intro ?? base.intro, 200) ? { subheading: clean(copy.intro ?? base.intro, 200) } : {}),
      ...(form ? { ctaViewId: form.id, ctaLabel: clean(copy.cta, 28) ?? "Book now" } : {}),
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
