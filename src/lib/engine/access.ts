import type { Blueprint, DataRecord, Entity } from "@/lib/blueprint/types";
import type { RecordPut } from "@/lib/store/workspace-sync";
import { editedBy } from "./actors";
import { computeAll } from "./compute";

/**
 * Record-level access. A record type can be limited so staff and viewers see only their own records: those assigned
 * to them (a person or email field holding their name or email) or those they added (the record's Created by stamp,
 * src/lib/engine/actors.ts). Owners and admins always see everything. The server applies this to everything a
 * member reads (the workspace, sync, the API and MCP, the assistant) and checks every write, so records they can't
 * see never reach their browser.
 */

export type Viewer = {
  userId: string;
  role: "owner" | "admin" | "staff" | "viewer";
  name: string;
  email: string;
};

/** How a record type's own records are found: a field naming the member, or "created_by" for who added it. */
export const ADDED_BY = "created_by";

const norm = (s: string) => s.trim().toLowerCase();

/** Whether this person sees only some records of some record type. */
export const isLimited = (bp: Blueprint, viewer: Viewer) =>
  (viewer.role === "staff" || viewer.role === "viewer") && bp.entities.some((e) => e.access);

/** Whether a member sees a record. */
export function canSee(bp: Blueprint, viewer: Viewer, record: DataRecord): boolean {
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  const by = bp.entities.find((e) => e.id === record.entityId)?.access?.by;
  if (!by) return true;
  if (by === ADDED_BY) return record.createdBy?.id === viewer.userId;
  const mine = [viewer.name, viewer.email].map(norm).filter(Boolean);
  const value = record.data[by];
  return (Array.isArray(value) ? value : [value]).some(
    (v) => typeof v === "string" && mine.includes(norm(v)),
  );
}

/** The records a member sees. */
export const visibleTo = <T extends { record: DataRecord } | DataRecord>(
  bp: Blueprint,
  viewer: Viewer,
  rows: T[],
): T[] =>
  isLimited(bp, viewer) ? rows.filter((r) => canSee(bp, viewer, "record" in r ? r.record : r)) : rows;

/** "Only the bookings assigned to them (Coach)", for Settings and the table a limited member sees. */
export function accessLabel(entity: Entity): string | null {
  const by = entity.access?.by;
  if (!by) return null;
  const plural = entity.pluralName.toLowerCase();
  if (by === ADDED_BY) return `Only the ${plural} they added`;
  const field = entity.fields.find((f) => f.id === by);
  return `Only the ${plural} assigned to them (${field?.name ?? by})`;
}

/**
 * A limited member's save, checked and completed on the server: edits and deletes of records they can't see are
 * refused. Their browser works out totals from the records it has, which would undercount, so changes that only
 * move formulas and rollups are dropped, and the totals are worked out here from every record: rollups that change
 * on other records (a player's total when their booking is paid) are saved too.
 */
export function guardWrites(
  bp: Blueprint,
  viewer: Viewer,
  stored: { record: DataRecord; rev: number }[],
  puts: RecordPut[],
  deletes: { id: string }[],
  now: Date,
): { ok: true; puts: RecordPut[] } | { ok: false; message: string } {
  const byId = new Map(stored.map((s) => [s.record.id, s]));
  for (const id of [...puts.map((p) => p.record.id), ...deletes.map((d) => d.id)]) {
    const was = byId.get(id);
    if (was && !canSee(bp, viewer, was.record)) {
      const entity = bp.entities.find((e) => e.id === was.record.entityId);
      return {
        ok: false,
        message: `You can only change the ${entity?.pluralName.toLowerCase() ?? "records"} you can see.`,
      };
    }
  }
  return { ok: true, puts: settleTotals(bp, stored, puts, deletes, now) };
}

/**
 * A save whose browser has only some records (a limited member, src/lib/engine/access.ts; or a windowed record
 * type, src/lib/engine/window.ts), completed on the server: changes that only move formulas and rollups are dropped,
 * since that browser worked them out from part of the records, and totals are worked out here from every record.
 * Rollups that change on records nobody sent (a player's total when one of their bookings is paid) are saved too.
 */
export function settleTotals(
  bp: Blueprint,
  stored: { record: DataRecord; rev: number }[],
  puts: RecordPut[],
  deletes: { id: string }[],
  now: Date,
): RecordPut[] {
  const byId = new Map(stored.map((s) => [s.record.id, s]));
  const kept = puts.filter((p) => {
    const was = byId.get(p.record.id);
    return !was || editedBy(bp, was.record, p.record);
  });
  const sent = new Map(kept.map((p) => [p.record.id, p]));
  const gone = new Set(deletes.map((d) => d.id));
  const merged = [
    ...stored.filter((s) => !gone.has(s.record.id)).map((s) => sent.get(s.record.id)?.record ?? s.record),
    ...kept.filter((p) => !byId.has(p.record.id)).map((p) => p.record),
  ];
  const rollups = new Map(
    bp.entities.map((e) => [e.id, e.fields.filter((f) => f.type === "rollup").map((f) => f.id)]),
  );
  const out: RecordPut[] = [];
  for (const r of computeAll(bp, merged, now)) {
    const p = sent.get(r.id);
    if (p) {
      out.push({ ...p, record: r });
      continue;
    }
    const was = byId.get(r.id);
    const changed = (rollups.get(r.entityId) ?? []).some(
      (f) => JSON.stringify(was?.record.data[f] ?? null) !== JSON.stringify(r.data[f] ?? null),
    );
    if (was && changed) out.push({ record: r, rev: was.rev });
  }
  return out;
}
