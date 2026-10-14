import "server-only";
import { sql } from "kysely";
import { recordTitle } from "@/lib/blueprint/lookup";
import type { DataRecord, FieldValue, RecordData } from "@/lib/blueprint/types";
import { createRecord } from "@/lib/engine/records";
import { isTimeRange } from "@/lib/format";
import {
  formatCell,
  type PageDocs,
  type PublicPageData,
  type PublicSite,
  publicExtras,
  publicFieldsOf,
  publicForm,
  resolvePage,
  siteOf,
} from "@/lib/public/resolve";
import { type Slot, slotsFor } from "@/lib/public/slots";
import { blueprintOf, type WorkspaceDoc } from "@/lib/store/workspace-model";
import { db } from "./db";

const ID = /^[a-z0-9][a-z0-9-]{1,79}$/;

async function readDoc(slug: string): Promise<WorkspaceDoc | null> {
  if (!ID.test(slug)) return null;
  const { rows } = await sql<{ doc: WorkspaceDoc }>`select doc from workspace where id = ${slug}`.execute(db);
  return rows[0]?.doc ?? null;
}

/** The public site of a workspace and one of its pages (the first when none is named). Null if nothing is public. */
export async function publicPage(
  slug: string,
  viewId?: string,
): Promise<{ site: PublicSite; page: PublicPageData } | null> {
  const doc = await readDoc(slug);
  if (!doc || doc.setup) return null;
  const bp = blueprintOf(doc);
  const site = siteOf(slug, doc.name, bp);
  if (!site) return null;
  const page = resolvePage(
    bp,
    doc.records,
    (doc.docs ?? {}) as PageDocs,
    slug,
    viewId ?? site.pages[0].id,
    new Date(),
    doc.name,
  );
  return page ? { site, page } : null;
}

export async function publicSlots(
  slug: string,
  viewId: string,
  resourceId: string,
  day: string,
): Promise<Slot[] | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const doc = await readDoc(slug);
  if (!doc) return null;
  const bp = blueprintOf(doc);
  const view = bp.views.find((v) => v.id === viewId);
  if (view?.type !== "form" || !view.public) return null;
  return slotsFor(bp, doc.records, view, resourceId, day);
}

export type SubmitResult =
  | { ok: true; reference: string; title: string; summary: { name: string; text: string }[] }
  | { ok: false; status: number; message: string; fieldErrors?: { fieldId?: string; message: string }[] };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/**
 * A visitor submits a public form. Only the fields the form shows are accepted, choices must be ones it offered,
 * and the record goes through the same engine as in the app (required fields, double bookings, rules). The
 * workspace row is locked while the record is added, so two bookings can't take the same slot.
 */
export async function submitPublicForm(
  slug: string,
  viewId: string,
  raw: Record<string, unknown>,
  now = new Date(),
  /** Add-ons picked: item id → how many. Only items the form offers are accepted. */
  rawExtras: Record<string, unknown> = {},
): Promise<SubmitResult> {
  if (!ID.test(slug)) return { ok: false, status: 404, message: "This page doesn't exist." };
  return db.transaction().execute(async (trx) => {
    const { rows } = await sql<{
      doc: WorkspaceDoc;
    }>`select doc from workspace where id = ${slug} for update`.execute(trx);
    const doc = rows[0]?.doc;
    if (!doc) return { ok: false, status: 404, message: "This page doesn't exist." } as const;
    const bp = blueprintOf(doc);
    const view = bp.views.find((v) => v.id === viewId);
    const entity = bp.entities.find((e) => e.id === view?.entityId);
    if (view?.type !== "form" || !view.public || !entity)
      return { ok: false, status: 404, message: "This form isn't taking submissions." } as const;
    const form = publicForm(bp, doc.records, view);
    const input: RecordData = {};
    for (const f of publicFieldsOf(bp, view)) {
      const v = raw[f.id];
      if (v === undefined || v === null || v === "") continue;
      let value: FieldValue | undefined;
      switch (f.type) {
        case "text":
          value = text(v, 300);
          break;
        case "long_text":
          value = text(v, 4000);
          break;
        case "number":
        case "money":
        case "percent":
          value = typeof v === "number" && Number.isFinite(v) ? v : undefined;
          break;
        case "date":
          value = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
          break;
        case "datetime":
          value =
            typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined;
          break;
        case "time_range":
          value = isTimeRange(v as FieldValue)
            ? { start: String((v as { start: string }).start), end: String((v as { end: string }).end) }
            : undefined;
          break;
        case "select":
          value = typeof v === "string" && f.options?.some((o) => o.id === v) ? v : undefined;
          break;
        case "multi_select":
          value = Array.isArray(v)
            ? v.filter((x): x is string => typeof x === "string" && !!f.options?.some((o) => o.id === x))
            : undefined;
          break;
        case "checkbox":
          value = v === true;
          break;
        case "relation":
          value = typeof v === "string" && form?.choices[f.id]?.some((c) => c.id === v) ? v : undefined;
          break;
      }
      if (value !== undefined) input[f.id] = value;
    }
    // The business sets statuses; a new submission starts at the first one (e.g. Pending or Unpaid).
    // Typed-in amounts are the business's to set too; a required one starts at zero for staff to fill in.
    for (const f of entity.fields) {
      if (f.type === "status" && f.options?.[0] && input[f.id] === undefined) input[f.id] = f.options[0].id;
      if (f.type === "money" && f.required && input[f.id] === undefined) input[f.id] = 0;
    }
    const booking = entity.booking;
    const time = booking ? input[booking.timeFieldId] : undefined;
    if (
      booking &&
      isTimeRange(time ?? null) &&
      Date.parse((time as { start: string }).start) <= now.getTime()
    )
      return { ok: false, status: 422, message: "Pick a time that hasn't started yet." } as const;

    const result = createRecord({ blueprint: bp, records: doc.records }, entity.id, input, now);
    if (!result.ok)
      return {
        ok: false,
        status: 422,
        message: result.errors[0]?.message ?? "Check the form and try again.",
        fieldErrors: result.errors,
      } as const;
    // Add-ons become line items under the new record, through the same engine (rules, totals, roll-ups).
    let data = result.data;
    const picked: { title: string; quantity: number }[] = [];
    const offered = publicExtras(bp, doc.records, view, now);
    const extras = view.extras;
    const line = extras && bp.entities.find((e) => e.id === extras.lineEntityId);
    if (offered && extras && line?.parent) {
      const parentField = line.parent.fieldId;
      for (const [itemId, n] of Object.entries(rawExtras).slice(0, 20)) {
        const item = offered.items.find((i) => i.id === itemId);
        const quantity = typeof n === "number" && Number.isInteger(n) ? Math.min(n, 50) : 0;
        if (!item || quantity < 1) continue;
        const lineData: RecordData = { [parentField]: result.record.id, [extras.itemFieldId]: item.id };
        if (extras.quantityFieldId) lineData[extras.quantityFieldId] = quantity;
        // Other counts the line asks for (hours, nights) start at 1, and its own name (a Title field) is the item's;
        // the business can change them.
        for (const f of line.fields) {
          if (lineData[f.id] !== undefined) continue;
          if (f.required && f.type === "number") lineData[f.id] = 1;
          if ((f.required || f.id === line.primaryFieldId) && f.type === "text") lineData[f.id] = item.title;
        }
        const added = createRecord(data, line.id, lineData, now);
        if (!added.ok)
          return {
            ok: false,
            status: 422,
            message: `${item.title}: ${added.errors[0]?.message ?? "couldn't be added"}`,
          } as const;
        data = added.data;
        picked.push({ title: item.title, quantity });
      }
    }
    await sql`update workspace set doc = jsonb_set(doc, '{records}', ${JSON.stringify(data.records)}::jsonb), updated_at = now()
      where id = ${slug}`.execute(trx);
    const record: DataRecord = data.records.find((r) => r.id === result.record.id) ?? result.record;
    const shown = entity.fields.filter(
      (f) =>
        (f.id === booking?.resourceFieldId ||
          f.id === booking?.timeFieldId ||
          f.type === "money" ||
          (f.type === "formula" && f.formula?.resultType === "money")) &&
        record.data[f.id] !== undefined,
    );
    return {
      ok: true,
      reference: record.id.slice(-6).toUpperCase(),
      title: recordTitle(entity, record),
      summary: [
        ...shown
          .filter((f) => f.type !== "money" && !(f.type === "formula" && f.formula?.resultType === "money"))
          .map((f) => ({ name: f.name, text: formatCell(bp, data.records, f, record.data[f.id]).text })),
        ...(picked.length
          ? [
              {
                name: offered?.title ?? "Add-ons",
                text: picked.map((p) => `${p.title} × ${p.quantity}`).join(", "),
              },
            ]
          : []),
        ...shown
          .filter((f) => f.type === "money" || (f.type === "formula" && f.formula?.resultType === "money"))
          .map((f) => ({ name: f.name, text: formatCell(bp, data.records, f, record.data[f.id]).text })),
      ],
    } as const;
  });
}

/* A small per-address limit so a public form can't be flooded. */
const hits = new Map<string, number[]>();
export function allowSubmission(key: string, limit = 8, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}
