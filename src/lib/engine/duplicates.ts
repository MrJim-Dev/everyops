import { getEntity } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, Field, FieldValue, RecordData, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "./compute";

/**
 * Duplicate records: the same customer added twice, once from the front desk and once from a public form. Two
 * records of a type match on an email or phone field, compared loosely (case, spaces, a country code). Merging keeps
 * one, fills its empty fields from the other, points every link at it, and removes the other.
 */

const CONTACT = /e-?mail|phone|mobile|cell|contact/i;

/**
 * The fields two records of a type are compared on: its email and phone fields, and text fields named like one
 * ("Phone", "Mobile no.", "Contact"), which many systems use.
 */
export const matchFields = (entity: Entity): Field[] =>
  entity.fields.filter(
    (f) =>
      !f.formula &&
      !f.rollup &&
      (f.type === "email" ||
        f.type === "phone" ||
        (f.type === "text" && (CONTACT.test(f.name) || CONTACT.test(f.id)))),
  );

/** A value as compared: an email in lower case; a phone's last 10 digits (0917… and +63 917… are one number). */
export function matchKey(field: Field, value: FieldValue | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (field.type === "email" || value.includes("@")) return value.trim().toLowerCase();
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}

export type DuplicateMatch = { record: DataRecord; field: Field };

/** Other records of the type that share an email or phone with these values, most recently changed first. */
export function findDuplicates(
  entity: Entity,
  data: RecordData,
  records: DataRecord[],
  ignoreId?: string,
): DuplicateMatch[] {
  const fields = matchFields(entity);
  const keys = fields.map((f) => [f, matchKey(f, data[f.id])] as const).filter(([, k]) => k);
  if (!keys.length) return [];
  const found = new Map<string, DuplicateMatch>();
  for (const r of records) {
    if (r.entityId !== entity.id || r.id === ignoreId || found.has(r.id)) continue;
    const hit = keys.find(([f, k]) => matchKey(f, r.data[f.id]) === k);
    if (hit) found.set(r.id, { record: r, field: hit[0] });
  }
  return [...found.values()].sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
}

const empty = (v: FieldValue | undefined) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The links (relation fields of any type) that point at records of this type. */
export const linksTo = (ws: WorkspaceData, entityId: string) =>
  ws.blueprint.entities.flatMap((e) =>
    e.fields
      .filter((f) => f.type === "relation" && f.relation?.entityId === entityId)
      .map((f) => ({ entity: e, field: f })),
  );

/** How many records link to a record: a player's bookings, a customer's orders. */
export function linkCount(ws: WorkspaceData, record: DataRecord): number {
  const links = linksTo(ws, record.entityId);
  return ws.records.filter((r) =>
    links.some((l) => l.entity.id === r.entityId && r.data[l.field.id] === record.id),
  ).length;
}

export type MergeResult =
  | { ok: true; data: WorkspaceData; record: DataRecord; moved: number; filled: string[] }
  | { ok: false; message: string };

/**
 * Merges one record into another of the same type: the kept record's empty fields take the other's values, every
 * link to the other points at the kept one (so totals like visits and amount spent add up), and the other is removed.
 * Moving links isn't an edit to those records, so their save automations don't run again.
 */
export function mergeInto(
  ws: WorkspaceData,
  keepId: string,
  dropId: string,
  now: Date = new Date(),
): MergeResult {
  const keep = ws.records.find((r) => r.id === keepId);
  const drop = ws.records.find((r) => r.id === dropId);
  if (!keep || !drop) return { ok: false, message: "One of these records no longer exists." };
  if (keep.id === drop.id) return { ok: false, message: "Choose two different records." };
  if (keep.entityId !== drop.entityId)
    return { ok: false, message: "Only records of the same type can be merged." };
  const entity = getEntity(ws.blueprint, keep.entityId);
  const stamp = now.toISOString();
  const filled = entity.fields
    .filter((f) => !f.formula && !f.rollup && f.type !== "created_by" && f.type !== "edited_by")
    .filter((f) => empty(keep.data[f.id]) && !empty(drop.data[f.id]))
    .map((f) => f.id);
  const kept: DataRecord = filled.length
    ? {
        ...keep,
        data: { ...keep.data, ...Object.fromEntries(filled.map((id) => [id, drop.data[id]])) },
        updatedAt: stamp,
      }
    : keep;
  const links = linksTo(ws, entity.id);
  let moved = 0;
  const records = ws.records.flatMap((r): DataRecord[] => {
    if (r.id === drop.id) return [];
    if (r.id === keep.id) return [kept];
    const own = links.filter((l) => l.entity.id === r.entityId && r.data[l.field.id] === drop.id);
    if (!own.length) return [r];
    moved++;
    return [
      {
        ...r,
        data: { ...r.data, ...Object.fromEntries(own.map((l) => [l.field.id, keep.id])) },
        updatedAt: stamp,
      },
    ];
  });
  const computed = computeAll(ws.blueprint, records, now);
  return {
    ok: true,
    data: { ...ws, records: computed },
    record: computed.find((r) => r.id === keep.id) ?? kept,
    moved,
    filled,
  };
}
