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
  Blueprint,
  DataRecord,
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
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRange,
  isTimeRange,
} from "@/lib/format";
import { pageHtml } from "./html-page";

export type PageDocs = Record<string, { body: string } | undefined>;

export type Cell = {
  fieldId: string;
  name: string;
  kind: "text" | "markdown" | "image" | "status" | "number";
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
  fields: PublicField[];
  /** For relation fields: the records a visitor may choose from. */
  choices: Record<string, { id: string; title: string }[]>;
  /** Booking forms pick a resource, a day and a free slot instead of typing times. */
  booking?: { resourceFieldId: string; timeFieldId: string; resources: PublicResource[] };
  /** Multi-step forms: the fields of each step, in order. */
  steps?: { title: string; description?: string; fieldIds: string[]; extras?: boolean }[];
  /** With steps: a summary to check before sending. */
  review?: boolean;
  /** Add-ons people pick with a quantity; only their name and price are shown. */
  extras?: { title: string; items: PublicExtraItem[] };
};

export type PublicExtraItem = { id: string; title: string; price?: number; priceText?: string };

export type ResolvedBlock =
  | { id: string; type: "hero"; heading: string; subheading?: string; ctaLabel?: string; ctaHref?: string }
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
  | { id: string; type: "form"; title?: string; form: PublicForm };

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
  return views.length
    ? { slug, name, pages: views.map((v) => ({ id: v.id, name: v.name, type: v.type })) }
    : null;
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
      return { ...base, kind: "text", text: optionOf(field, value)?.label ?? String(value) };
    case "multi":
      return {
        ...base,
        kind: "text",
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
    if (view.type !== "html")
      for (const block of view.blocks ?? []) if (block.type === "records") ids.add(block.entityId);
  return ids;
}

/**
 * Fields a visitor fills in. Statuses and prices are the business's call, and computed or uploaded fields
 * aren't asked, so a visitor can't type their own fee.
 */
export function publicFieldsOf(bp: Blueprint, view: FormView): Field[] {
  const entity = bp.entities.find((e) => e.id === view.entityId);
  if (!entity) return [];
  const published = publishedEntities(bp);
  const editable = editableFields(entity).filter(
    (f) =>
      f.type !== "status" &&
      f.type !== "money" &&
      f.type !== "image" &&
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

export function publicForm(bp: Blueprint, records: DataRecord[], view: FormView): PublicForm | null {
  const entity = bp.entities.find((e) => e.id === view.entityId);
  if (!entity) return null;
  const fields = publicFieldsOf(bp, view);
  const choices: PublicForm["choices"] = {};
  for (const f of fields) {
    if (f.type !== "relation" || !f.relation) continue;
    const target = bp.entities.find((e) => e.id === f.relation?.entityId);
    if (!target) continue;
    choices[f.id] = records
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
    booking = {
      resourceFieldId: b.resourceFieldId,
      timeFieldId: b.timeFieldId,
      resources: records
        .filter((r) => r.entityId === resourceEntity.id)
        .map((r) => ({ id: r.id, title: recordTitle(resourceEntity, r), ...hours })),
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
    ).map(({ title, description, fieldIds, extras: picker }) => ({
      title,
      description,
      fieldIds,
      ...(picker ? { extras: true } : {}),
    }));
    // The slot is picked under the resource, so it always belongs to the resource's step.
    if (booking) {
      const { resourceFieldId, timeFieldId } = booking;
      steps = steps.map((s) => ({ ...s, fieldIds: s.fieldIds.filter((id) => id !== timeFieldId) }));
      const home = steps.find((s) => s.fieldIds.includes(resourceFieldId)) ?? steps[0];
      home.fieldIds.push(timeFieldId);
      steps = steps.filter((s) => s.fieldIds.length || s.extras);
    }
  }
  return {
    viewId: view.id,
    title: view.name,
    intro: view.intro,
    submitLabel: view.submitLabel ?? `Send ${entity.name.toLowerCase()}`,
    fields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      required: !!f.required,
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
  return docs[docKey(viewId, block.id)]?.body;
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
        const target = block.ctaViewId && publicIds.has(block.ctaViewId) ? block.ctaViewId : undefined;
        out.push({
          id: block.id,
          type: "hero",
          heading: clamp(edited.heading ?? block.heading, 120) ?? "",
          subheading: clamp(edited.subheading ?? block.subheading, 400),
          ctaLabel: target ? (edited.ctaLabel ?? block.ctaLabel ?? "Book now") : undefined,
          ctaHref: target ? sitePath(slug, target) : undefined,
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
        if (form) out.push({ id: block.id, type: "form", title: block.title, form });
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
): PublicPageData | null {
  const view = bp.views.find((v) => v.id === viewId);
  if (!view || !isPublic(view)) return null;
  if (view.type === "html") return htmlPage(bp, records, docs, view);
  if (view.type !== "landing" && view.type !== "form") return null;
  const blocks = resolveBlocks(bp, records, docs, slug, view, now);
  if (view.type === "landing") return { id: view.id, name: view.name, type: "landing", blocks };
  const form = publicForm(bp, records, view);
  return form ? { id: view.id, name: view.name, type: "form", blocks, form } : null;
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
