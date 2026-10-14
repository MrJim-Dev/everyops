/**
 * Public pages (landing pages and public forms) as plain data: what a visitor is allowed to see, already formatted.
 * The server uses this for /s/[workspace] and the app uses it for its preview, so both always match.
 * Only fields a block lists are included, and a form only offers records people may see (bookable resources,
 * or record types a public block already shows), never, say, the list of customers.
 */
import { displayKind, editableFields } from "@/lib/blueprint/field-kind";
import { formSteps, placeExtras } from "@/lib/blueprint/form-steps";
import { findRecord, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type {
  Block,
  BlockItem,
  Blueprint,
  BookingLayout,
  DataRecord,
  Entity,
  Field,
  FieldType,
  FieldValue,
  FormView,
  HtmlPageView,
  LandingView,
  Tone,
  View,
} from "@/lib/blueprint/types";
import { applyFilter, sortRecords } from "@/lib/engine/query";
import { autoReferenceFields } from "@/lib/engine/references";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRange,
  isTimeRange,
} from "@/lib/format";
import { type HeroFact, heroFacts } from "./hero-facts";
import { pageHtml } from "./html-page";
import { bookLabel, cleanIntro, defaultCopy, mainForm, offeringOf, standardBlocks } from "./site-template";

export type PageDocs = Record<string, { body: string } | undefined>;

/**
 * The standard site's first default lines, saved into pages made before Oct 14. They're replaced by today's default
 * when a page is shown; words a person or the AI wrote are never touched.
 */
const OLD_DEFAULT_INTRO =
  /^(Send your request online and .+ will get back to you\.|Book .+ in a few taps and get a confirmation from .+\.)$/;

export type Cell = {
  fieldId: string;
  name: string;
  /** tag: a choice (a court's surface, an item's category), shown as a small label. */
  kind: "text" | "markdown" | "image" | "status" | "number" | "tag";
  text: string;
  tone?: Tone;
};
export type PublicItem = { id: string; cells: Cell[] };

export type PublicField = {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
  range?: "dates" | "times";
  options?: { id: string; label: string }[];
};

export type PublicResource = {
  id: string;
  title: string;
  opensAt: string;
  closesAt: string;
  slotMinutes: number;
};

export type PublicForm = {
  viewId: string;
  title: string;
  intro?: string;
  submitLabel: string;
  /** Text that was written into the button label but is too long for a button; shown above it. */
  submitNote?: string;
  fields: PublicField[];
  /** For relation fields: the records a visitor may choose from. */
  choices: Record<string, { id: string; title: string }[]>;
  /**
   * Booking forms pick a resource, a day and free slots instead of typing times. With multiple, a visitor can pick
   * several slots in a row as one booking. dayFieldIds are the record's own date fields for the booking day: they
   * aren't asked, they're filled in from the picked slot (here and on the server).
   */
  booking?: {
    resourceFieldId: string;
    timeFieldId: string;
    resources: PublicResource[];
    multiple: boolean;
    dayFieldIds: string[];
    /** Date fields for the booking's last day (Check-out, Departure): filled from the picked range's end. */
    endDayFieldIds: string[];
    /** How the picker looks (see FormView.bookingLayout). */
    layout: BookingLayout;
    /** Whole days (a stay from check-in to check-out) instead of times. */
    dates: boolean;
  };
  /** Multi-step forms: the fields of each step, in order, and the form's blocks shown in that step. */
  steps?: {
    title: string;
    description?: string;
    fieldIds: string[];
    extras?: boolean;
    blockIds?: string[];
    blocks?: ResolvedBlock[];
  }[];
  /** With steps: a summary to check before sending. */
  review?: boolean;
  /** Add-ons people pick with a quantity; only their name and price are shown. */
  extras?: { title: string; items: PublicExtraItem[] };
};

export type PublicExtraItem = { id: string; title: string; price?: number; priceText?: string };

export type ResolvedBlock =
  | {
      id: string;
      type: "hero";
      heading: string;
      subheading?: string;
      ctaLabel?: string;
      ctaHref?: string;
      /** A quieter second button down to what's offered on the same page, e.g. See our courts. */
      secondaryLabel?: string;
      secondaryHref?: string;
      /** What a visitor wants to know before booking, from the data: how many, hours, price, how to pay. */
      facts?: HeroFact[];
    }
  | { id: string; type: "text"; markdown: string }
  | { id: string; type: "html"; html: string }
  | {
      id: string;
      type: "records";
      title?: string;
      layout: "cards" | "list" | "table" | "faq";
      columns: { id: string; name: string }[];
      items: PublicItem[];
    }
  | { id: string; type: "form"; title?: string; form: PublicForm }
  | { id: string; type: "highlights" | "steps"; title?: string; items: BlockItem[] }
  | {
      id: string;
      type: "contact";
      title?: string;
      phone?: string;
      email?: string;
      address?: string;
      hours?: string;
    };

export type PublicPageData = {
  id: string;
  name: string;
  type: "landing" | "form" | "html";
  blocks: ResolvedBlock[];
  /** Form pages: the form itself, shown before their blocks. */
  form?: PublicForm;
  /** HTML pages: the owner's page, and the public forms it may send to (by view id). */
  html?: string;
  forms?: PublicForm[];
};

export type PublicSite = {
  slug: string;
  name: string;
  pages: { id: string; name: string; type: "landing" | "form" | "html" }[];
  /** The header's button: the main public form, named for what it does ("Book a court"). */
  book?: { id: string; label: string };
};

export const sitePath = (slug: string, viewId?: string) => (viewId ? `/s/${slug}/${viewId}` : `/s/${slug}`);
export const docKey = (viewId: string, blockId: string) => `${viewId}:${blockId}`;

export function isPublic(view: View): boolean {
  return (
    (view.type === "landing" && view.public !== false) ||
    ((view.type === "form" || view.type === "html") && view.public === true)
  );
}

export function publicViews(bp: Blueprint): (LandingView | FormView | HtmlPageView)[] {
  return bp.views.filter((v): v is LandingView | FormView | HtmlPageView => isPublic(v));
}

/** The site's pages in sidebar order: landing and custom HTML pages first (the first is the home page), then forms. */
export function siteOf(slug: string, name: string, bp: Blueprint): PublicSite | null {
  const order = bp.systems.flatMap((s) => s.viewIds);
  const views = publicViews(bp).sort(
    (a, b) =>
      Number(b.type !== "form") - Number(a.type !== "form") || order.indexOf(a.id) - order.indexOf(b.id),
  );
  if (!views.length) return null;
  const pages = views.map((v) => ({ id: v.id, name: v.name, type: v.type }));
  // A site with only forms still gets a home page: the standard one, built from its data.
  if (views.every((v) => v.type === "form"))
    pages.unshift({ id: autoHomeId(bp), name: "Home", type: "landing" });
  const main = mainForm(bp);
  const book = main ?? views.find((v): v is FormView => v.type === "form");
  return { slug, name, pages, ...(book ? { book: { id: book.id, label: bookLabel(bp, book.id) } } : {}) };
}

/** The id of the standard home page a site gets when it has no landing page of its own. */
export function autoHomeId(bp: Blueprint): string {
  return bp.views.some((v) => v.id === "home") ? "site_home" : "home";
}

/** One value as text a visitor reads. Relations show the linked record's name; images and markdown pass through. */
export function formatCell(
  bp: Blueprint,
  records: DataRecord[],
  field: Field,
  value: FieldValue | undefined,
): Cell {
  const base = { fieldId: field.id, name: field.name };
  if (value === undefined || value === null || value === "") return { ...base, kind: "text", text: "" };
  const kind = displayKind(bp, field);
  switch (kind) {
    case "image":
      return { ...base, kind: "image", text: typeof value === "string" ? value : "" };
    case "long_text":
      return { ...base, kind: "markdown", text: String(value) };
    case "money":
      return { ...base, kind: "number", text: formatMoney(Number(value)) };
    case "number":
      return { ...base, kind: "number", text: formatNumber(Number(value)) };
    case "percent":
      return { ...base, kind: "number", text: formatPercent(Number(value)) };
    case "date":
      return { ...base, kind: "text", text: typeof value === "string" ? formatDate(value) : "" };
    case "datetime":
      return { ...base, kind: "text", text: typeof value === "string" ? formatDateTime(value) : "" };
    case "time_range":
      return {
        ...base,
        kind: "text",
        text: isTimeRange(value)
          ? field.range === "dates"
            ? formatRange(value)
            : `${formatDate(value.start)} · ${formatRange(value)}`
          : "",
      };
    case "status": {
      const option = optionOf(field, value);
      return { ...base, kind: "status", text: option?.label ?? "", tone: option?.tone };
    }
    case "choice":
      return { ...base, kind: "tag", text: optionOf(field, value)?.label ?? String(value) };
    case "multi":
      return {
        ...base,
        kind: "tag",
        text: (Array.isArray(value) ? value : []).map((v) => optionOf(field, v)?.label ?? v).join(", "),
      };
    case "checkbox":
      return { ...base, kind: "text", text: value ? "Yes" : "No" };
    case "relation": {
      const target = field.relation ? bp.entities.find((e) => e.id === field.relation?.entityId) : undefined;
      const linked = typeof value === "string" ? findRecord(records, value) : undefined;
      return { ...base, kind: "text", text: target && linked ? recordTitle(target, linked) : "" };
    }
    default:
      return { ...base, kind: "text", text: String(value) };
  }
}

/** Record types a visitor may pick from: bookable resources, and anything a public block already lists. */
function publishedEntities(bp: Blueprint): Set<string> {
  const ids = new Set(bp.entities.filter((e) => e.resource).map((e) => e.id));
  for (const view of publicViews(bp))
    if (view.type !== "html") {
      for (const block of view.blocks ?? []) if (block.type === "records") ids.add(block.entityId);
      // The payment methods a public form links to are shown on its page (paymentBlock), so visitors can pick one.
      if (view.type === "form") {
        const pay = paymentLinkOf(bp, view);
        if (pay) ids.add(pay.entity.id);
      }
    }
  return ids;
}

const PAYMENT = /payment.?method|pay.?method|pay.?channel|payment.?option|bank|wallet|gcash|qr/i;

/**
 * A form's link to the business's payment methods (GCash, Maya, bank accounts), when it has one: a relation to a
 * record type named like payment methods, or one that keeps account numbers and QR codes.
 */
export function paymentLinkOf(bp: Blueprint, view: FormView): { field: Field; entity: Entity } | undefined {
  const entity = bp.entities.find((e) => e.id === view.entityId);
  for (const field of entity?.fields ?? []) {
    if (field.type !== "relation") continue;
    const target = bp.entities.find((e) => e.id === field.relation?.entityId);
    if (!target) continue;
    const named = PAYMENT.test(`${target.id} ${target.name} ${field.id} ${field.name}`);
    const keepsAccounts =
      target.fields.some((f) => f.type === "image" && /qr/i.test(`${f.id} ${f.name}`)) &&
      target.fields.some((f) => /account|number/i.test(`${f.id} ${f.name}`));
    if (named || keepsAccounts) return { field, entity: target };
  }
  return undefined;
}

/**
 * The "How to pay" cards a public form shows when it links to payment methods but its page doesn't list them:
 * the active ones with their account details, QR code and instructions. Null when the page already lists them.
 */
export function paymentBlock(bp: Blueprint, view: FormView): Extract<Block, { type: "records" }> | null {
  const link = paymentLinkOf(bp, view);
  if (!link) return null;
  if ((view.blocks ?? []).some((b) => b.type === "records" && b.entityId === link.entity.id)) return null;
  const active = link.entity.fields.find(
    (f) => f.type === "checkbox" && /active|enabled|show|published/i.test(f.id),
  );
  const status = link.entity.fields.find(
    (f) => f.type === "status" && f.options?.some((o) => o.id === "active"),
  );
  return {
    id: "auto_how_to_pay",
    type: "records",
    title: "How to pay",
    entityId: link.entity.id,
    layout: "cards",
    filter: active ? active.id : status ? `${status.id} == 'active'` : undefined,
    // The method's name first (cards are titled by it), then its account details, QR code and instructions.
    fieldIds: [
      link.entity.primaryFieldId,
      ...link.entity.fields
        .filter((f) => f.id !== link.entity.primaryFieldId && f.type !== "checkbox" && f.type !== "status")
        .map((f) => f.id),
    ],
  };
}

/** Longest label that still reads as a button. */
const MAX_BUTTON_LABEL = 40;

/**
 * A form's button text. AI designs sometimes write instructions into the label ("Request booking (50%
 * deposit) - scan the GCash QR…"); a button can't hold that, so the label keeps its first phrase and the
 * whole text becomes a note shown above the button.
 */
export function submitButton(label: string | undefined, fallback: string): { label: string; note?: string } {
  const text = label?.trim();
  if (!text) return { label: fallback };
  if (text.length <= MAX_BUTTON_LABEL) return { label: text };
  const head = text.split(/\s[-–—(:|]|[.!?](\s|$)/)[0]?.trim() ?? "";
  return { label: head && head.length <= MAX_BUTTON_LABEL ? head : fallback, note: text };
}

/**
 * A stranger's submission must say who they are and how to reach them: the form's first name field and its first
 * phone or email field are required on public forms even when the record type leaves them optional.
 */
export function visitorContactIds(fields: Field[]): Set<string> {
  const text = fields.filter((f) => f.type === "text");
  const label = (f: Field) => `${f.id.replace(/_/g, " ")} ${f.name}`;
  const name = text.find(
    (f) => /\bname\b|guest|customer|client|player/i.test(label(f)) && !/ref|code/i.test(label(f)),
  );
  const reach = text.find((f) => /phone|mobile|cell|e-?mail|contact/i.test(label(f)));
  return new Set([name?.id, reach?.id].filter((id): id is string => !!id));
}

/**
 * Fields a visitor fills in. Statuses and prices are the business's call, and computed or uploaded fields
 * aren't asked, so a visitor can't type their own fee.
 */
export function publicFieldsOf(bp: Blueprint, view: FormView): Field[] {
  const entity = bp.entities.find((e) => e.id === view.entityId);
  if (!entity) return [];
  const published = publishedEntities(bp);
  // Reference numbers are issued on submit (submitPublicForm), never typed by a visitor.
  const issued = new Set(autoReferenceFields(entity).map((f) => f.id));
  const editable = editableFields(entity).filter(
    (f) =>
      !issued.has(f.id) &&
      f.type !== "status" &&
      f.type !== "money" &&
      f.type !== "person" &&
      (f.type !== "relation" || published.has(f.relation?.entityId ?? "")),
  );
  const chosen = view.fieldIds.length
    ? [
        ...view.fieldIds.flatMap((id) => editable.filter((f) => f.id === id)),
        ...editable.filter((f) => f.required && !view.fieldIds.includes(f.id)),
      ]
    : editable;
  return chosen;
}

/** A plain date field that only repeats the booking's day ("Date", "Booking date", "Play day"), not a birthday. */
const DAY_FIELD =
  /^((booking|reservation|reserved|play|game|session|visit|event|start|arrival)?[\s_-]*(date|day)|check[\s_-]?in([\s_-]*(date|day))?|arrival)$/i;
/** A date field for the booking's last day: Check-out, Departure, End date. */
const END_DAY_FIELD =
  /^(check[\s_-]?out([\s_-]*(date|day))?|departure([\s_-]*(date|day))?|end[\s_-]*(date|day))$/i;

const dateFieldsMatching = (entity: Entity, pattern: RegExp) =>
  entity.booking
    ? entity.fields
        .filter((f) => f.type === "date" && (pattern.test(f.name.trim()) || pattern.test(f.id)))
        .map((f) => f.id)
    : [];

/** The record's date fields that are the booking's (first) day, so they follow the picked slot or stay. */
export function bookingDayFieldIds(entity: Entity): string[] {
  return dateFieldsMatching(entity, DAY_FIELD);
}

/** The record's date fields for the last day of a booking (a stay's check-out), filled from the picked range's end. */
export function bookingEndDayFieldIds(entity: Entity): string[] {
  return dateFieldsMatching(entity, END_DAY_FIELD);
}

export function publicForm(bp: Blueprint, records: DataRecord[], view: FormView): PublicForm | null {
  const entity = bp.entities.find((e) => e.id === view.entityId);
  if (!entity) return null;
  const fields = publicFieldsOf(bp, view);
  const contact = visitorContactIds(fields);
  const choices: PublicForm["choices"] = {};
  const pay = paymentBlock(bp, view);
  for (const f of fields) {
    if (f.type !== "relation" || !f.relation) continue;
    const target = bp.entities.find((e) => e.id === f.relation?.entityId);
    if (!target) continue;
    // Payment methods turned off by the business aren't offered.
    choices[f.id] = (pay?.entityId === target.id ? applyFilter(bp, target, records, pay.filter) : records)
      .filter((r) => r.entityId === target.id)
      .map((r) => ({ id: r.id, title: recordTitle(target, r) }));
  }
  let booking: PublicForm["booking"];
  const b = entity.booking;
  const resourceField = b ? entity.fields.find((f) => f.id === b.resourceFieldId) : undefined;
  const resourceEntity = resourceField?.relation
    ? bp.entities.find((e) => e.id === resourceField.relation?.entityId)
    : undefined;
  if (b && resourceEntity && fields.some((f) => f.id === b.timeFieldId)) {
    const hours = resourceEntity.resource ?? { opensAt: "08:00", closesAt: "20:00", slotMinutes: 60 };
    const dates = entity.fields.find((f) => f.id === b.timeFieldId)?.range === "dates";
    booking = {
      resourceFieldId: b.resourceFieldId,
      timeFieldId: b.timeFieldId,
      resources: records
        .filter((r) => r.entityId === resourceEntity.id)
        .map((r) => ({ id: r.id, title: recordTitle(resourceEntity, r), ...hours })),
      multiple: view.multipleSlots !== false,
      dayFieldIds: bookingDayFieldIds(entity).filter((id) => fields.some((f) => f.id === id)),
      endDayFieldIds: bookingEndDayFieldIds(entity).filter((id) => fields.some((f) => f.id === id)),
      layout: dates ? "month" : (view.bookingLayout ?? "days"),
      dates,
    };
    choices[b.resourceFieldId] ??= booking.resources.map((r) => ({ id: r.id, title: r.title }));
  }
  const extras = publicExtras(bp, records, view);
  let steps: PublicForm["steps"];
  if (view.steps?.length) {
    steps = placeExtras(
      formSteps(
        entity,
        view,
        fields.map((f) => f.id),
      ),
      extras?.title,
    ).map(({ title, description, fieldIds, extras: picker, blockIds }) => ({
      title,
      description,
      fieldIds,
      ...(picker ? { extras: true } : {}),
      ...(blockIds?.length ? { blockIds } : {}),
    }));
    // The slot is picked under the resource, so it always belongs to the resource's step. The booking's own date
    // field follows the slot, so no step asks it.
    if (booking) {
      const { resourceFieldId, timeFieldId, dayFieldIds, endDayFieldIds } = booking;
      steps = steps.map((s) => ({
        ...s,
        fieldIds: s.fieldIds.filter(
          (id) => id !== timeFieldId && !dayFieldIds.includes(id) && !endDayFieldIds.includes(id),
        ),
      }));
      const home = steps.find((s) => s.fieldIds.includes(resourceFieldId)) ?? steps[0];
      home.fieldIds.push(timeFieldId);
      steps = steps.filter((s) => s.fieldIds.length || s.extras || s.blockIds?.length);
    }
  }
  return {
    viewId: view.id,
    title: view.name,
    intro: view.intro,
    ...(() => {
      const button = submitButton(view.submitLabel, `Send ${entity.name.toLowerCase()}`);
      return { submitLabel: button.label, ...(button.note ? { submitNote: button.note } : {}) };
    })(),
    fields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      required: !!f.required || contact.has(f.id),
      description: f.description,
      range: f.range,
      options: f.options?.map((o) => ({ id: o.id, label: o.label })),
    })),
    choices,
    booking,
    steps,
    review: steps ? !!view.review : undefined,
    ...(extras ? { extras } : {}),
  };
}

/** The items a form offers as add-ons, each with its price when the item has one. */
export function publicExtras(
  bp: Blueprint,
  records: DataRecord[],
  view: FormView,
  now = new Date(),
): PublicForm["extras"] | undefined {
  const extras = view.extras;
  const line = extras && bp.entities.find((e) => e.id === extras.lineEntityId);
  const itemField = line?.fields.find((f) => f.id === extras?.itemFieldId);
  const items = bp.entities.find((e) => e.id === itemField?.relation?.entityId);
  if (!extras || !line || line.parent?.entityId !== view.entityId || !items) return undefined;
  const priceField = items.fields.find((f) => displayKind(bp, f) === "money");
  const offered = applyFilter(bp, items, records, extras.filter, now).map((r) => {
    const price = priceField ? Number(r.data[priceField.id]) : Number.NaN;
    return {
      id: r.id,
      title: recordTitle(items, r),
      ...(Number.isFinite(price) ? { price, priceText: formatMoney(price) } : {}),
    };
  });
  return offered.length
    ? { title: extras.title ?? items.pluralName, items: offered.slice(0, 40) }
    : undefined;
}

function textOf(docs: PageDocs, viewId: string, block: Block): string | undefined {
  // An empty override means "back to the block's own text" (the assistant clears overrides it rewrites).
  return docs[docKey(viewId, block.id)]?.body || undefined;
}

/** A page's blocks with live data filled in and any text the team edited in the app. */
export function resolveBlocks(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  slug: string,
  view: LandingView | FormView,
  now = new Date(),
): ResolvedBlock[] {
  const publicIds = new Set(publicViews(bp).map((v) => v.id));
  const out: ResolvedBlock[] = [];
  for (const block of view.blocks ?? []) {
    switch (block.type) {
      case "hero": {
        let edited: Partial<{ heading: string; subheading: string; ctaLabel: string }> = {};
        try {
          edited = JSON.parse(textOf(docs, view.id, block) ?? "{}");
        } catch {}
        // A hero without a working button still leads to the site's main form (older pages often had none).
        const main = mainForm(bp);
        const target =
          block.ctaViewId && publicIds.has(block.ctaViewId)
            ? block.ctaViewId
            : main && publicIds.has(main.id)
              ? main.id
              : undefined;
        const offer = offeringOf(bp);
        const fallbackLabel = target ? bookLabel(bp, target) : "Book now";
        // On a landing page: a second button down to its cards of what's offered, and the facts row.
        const offerBlock =
          view.type === "landing"
            ? view.blocks?.find(
                (b) => b.type === "records" && b.layout === "cards" && b.entityId === offer?.id,
              )
            : undefined;
        const offerTitle = offerBlock?.type === "records" ? offerBlock.title : undefined;
        const facts = view.type === "landing" ? heroFacts(bp, records, now) : [];
        out.push({
          id: block.id,
          type: "hero",
          heading: clamp(edited.heading ?? block.heading, 120) ?? "",
          // Whole sentences only, so a line that ran on (a looped AI answer) ends where its last sentence does.
          subheading: cleanIntro(
            edited.subheading ??
              (block.subheading && OLD_DEFAULT_INTRO.test(block.subheading)
                ? defaultCopy(bp, bp.workspaceName).intro
                : block.subheading),
            240,
          ),
          // "Book now" was the saved default before buttons were named for their form; it reads as the default now.
          ctaLabel: target
            ? (edited.ctaLabel ??
              (block.ctaLabel && block.ctaLabel !== "Book now" ? block.ctaLabel : fallbackLabel))
            : undefined,
          ctaHref: target ? sitePath(slug, target) : undefined,
          ...(offerBlock
            ? {
                secondaryLabel: `See ${(offerTitle ?? `our ${offer?.pluralName}`).toLowerCase()}`,
                secondaryHref: `#${offerBlock.id}`,
              }
            : {}),
          ...(facts.length ? { facts } : {}),
        });
        break;
      }
      case "text":
        out.push({ id: block.id, type: "text", markdown: textOf(docs, view.id, block) ?? block.markdown });
        break;
      case "html":
        out.push({ id: block.id, type: "html", html: textOf(docs, view.id, block) ?? block.html });
        break;
      case "records": {
        const entity = bp.entities.find((e) => e.id === block.entityId);
        if (!entity) break;
        const fields = block.fieldIds
          .map((id) => entity.fields.find((f) => f.id === id))
          .filter((f): f is Field => !!f);
        const rows = sortRecords(applyFilter(bp, entity, records, block.filter, now), block.sort).slice(
          0,
          block.limit ?? 50,
        );
        out.push({
          id: block.id,
          type: "records",
          title: block.title,
          layout: block.layout,
          columns: fields.map((f) => ({ id: f.id, name: f.name })),
          items: rows.map((r) => ({
            id: r.id,
            cells: fields.map((f) => formatCell(bp, records, f, r.data[f.id])),
          })),
        });
        break;
      }
      case "form": {
        const target = bp.views.find((v) => v.id === block.viewId);
        if (target?.type !== "form" || !target.public) break;
        const form = publicForm(bp, records, target);
        // A form embedded on a page brings the blocks its steps show (its other blocks stay on its own page).
        const own = form?.steps?.some((s) => s.blockIds?.length)
          ? withStepBlocks(form, resolveBlocks(bp, records, docs, slug, target, now)).form
          : form;
        if (own) out.push({ id: block.id, type: "form", title: block.title, form: own });
        break;
      }
      case "highlights":
      case "steps": {
        const items = block.items
          .map((i) => ({ title: clamp(i.title, 60) ?? "", body: clamp(i.body, 220) ?? "" }))
          .filter((i) => i.title);
        if (items.length) out.push({ id: block.id, type: block.type, title: clamp(block.title, 80), items });
        break;
      }
      case "contact": {
        const { id, type, title, phone, email, address, hours } = block;
        if (phone || email || address || hours)
          out.push({
            id,
            type,
            title: clamp(title, 80),
            phone: clamp(phone, 40),
            email: clamp(email, 80),
            address: clamp(address, 200),
            hours: clamp(hours, 160),
          });
        break;
      }
    }
  }
  return out;
}

/** A public page, or null when the view doesn't exist or isn't public. */
export function resolvePage(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  slug: string,
  viewId: string,
  now = new Date(),
  /** The business name, for the standard home page of a site that has none of its own. */
  siteName = "",
): PublicPageData | null {
  const view = bp.views.find((v) => v.id === viewId);
  if (!view && viewId === autoHomeId(bp) && !publicViews(bp).some((v) => v.type !== "form")) {
    if (!publicViews(bp).length) return null;
    const home: LandingView = {
      id: viewId,
      entityId: "",
      name: "Home",
      type: "landing",
      layout: "standard",
      blocks: standardBlocks(bp, siteName),
    };
    return {
      id: viewId,
      name: "Home",
      type: "landing",
      blocks: resolveBlocks(bp, records, docs, slug, home, now),
    };
  }
  if (!view || !isPublic(view)) return null;
  if (view.type === "html") return htmlPage(bp, records, docs, view);
  if (view.type !== "landing" && view.type !== "form") return null;
  const blocks = resolveBlocks(bp, records, docs, slug, view, now);
  if (view.type === "landing") return { id: view.id, name: view.name, type: "landing", blocks };
  const found = publicForm(bp, records, view);
  if (!found) return null;
  let form = found;
  // A form that takes payment shows how to pay, in its payment step when it has one.
  const pay = paymentBlock(bp, view);
  const payResolved = pay
    ? resolveBlocks(bp, records, docs, slug, { ...view, blocks: [pay] }, now)[0]
    : undefined;
  if (pay && payResolved && payResolved.type === "records" && payResolved.items.length) {
    blocks.unshift(payResolved);
    const link = paymentLinkOf(bp, view);
    const at = form.steps?.findIndex(
      (s) => (link && s.fieldIds.includes(link.field.id)) || /pay/i.test(s.title),
    );
    if (form.steps && at !== undefined && at >= 0)
      form = {
        ...form,
        steps: form.steps.map((s, i) => (i === at ? { ...s, blockIds: [...(s.blockIds ?? []), pay.id] } : s)),
      };
  }
  const placed = withStepBlocks(form, blocks);
  return { id: view.id, name: view.name, type: "form", blocks: placed.rest, form: placed.form };
}

/**
 * Puts the blocks a form's steps list (payment methods on the payment step) inside those steps; the rest stay below
 * the form.
 */
export function withStepBlocks(
  form: PublicForm,
  blocks: ResolvedBlock[],
): { form: PublicForm; rest: ResolvedBlock[] } {
  const placed = new Set(form.steps?.flatMap((s) => s.blockIds ?? []) ?? []);
  if (!placed.size) return { form, rest: blocks };
  const steps = form.steps?.map((s) => {
    const own = (s.blockIds ?? []).flatMap((id) => blocks.filter((b) => b.id === id));
    return own.length ? { ...s, blocks: own } : s;
  });
  return { form: { ...form, steps }, rest: blocks.filter((b) => !placed.has(b.id)) };
}

/** A custom HTML page with the public forms it may send to; the bridge refuses any other form. */
export function htmlPage(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  view: HtmlPageView,
): PublicPageData {
  const forms = bp.views
    .filter((v): v is FormView => v.type === "form" && v.public === true)
    .map((v) => publicForm(bp, records, v))
    .filter((f): f is PublicForm => !!f);
  return { id: view.id, name: view.name, type: "html", blocks: [], html: pageHtml(view, docs), forms };
}

/** Hero text has to fit a hero. */
function clamp(text: string | undefined, max: number): string | undefined {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).trim()}…`;
}
