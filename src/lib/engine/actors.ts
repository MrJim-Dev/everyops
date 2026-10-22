import type { Blueprint, DataRecord, Entity, RecordActor } from "@/lib/blueprint/types";

/**
 * Created by and Last edited by: who added a record and who changed it last. The server stamps them on every write
 * from the person, form, automation, API key or sync that made it (workspace_record.created_by / updated_by) and
 * never takes them from the browser. Fields of these types are filled from those stamps whenever records are read,
 * so a browser's copy always matches the server's and opening a workspace never looks like an edit.
 */
export const ACTOR_FIELD_TYPES = new Set(["created_by", "edited_by"]);

/**
 * The actor type a text field's name asks for: "Created by" / "Added by" / "Submitted by" → created_by, "Last edited
 * by" / "Edited by" / "Updated by" / "Modified by" → edited_by. The AI's schemas have no such type, so it names a
 * text field this way and it's turned into the real thing.
 */
export function actorTypeFor(name: string): "created_by" | "edited_by" | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(created|added|entered|recorded|submitted) by$/.test(n)) return "created_by";
  if (/^(last )?(edited|updated|modified|changed) by$/.test(n)) return "edited_by";
  return null;
}

const actorFields = (entity: Entity | undefined) =>
  (entity?.fields ?? []).filter((f) => ACTOR_FIELD_TYPES.has(f.type));

/** Records with their Created by / Last edited by fields filled from their stamps. Records not stamped yet read "". */
export function withActorValues(bp: Blueprint, records: DataRecord[]): DataRecord[] {
  const byEntity = new Map(bp.entities.map((e) => [e.id, actorFields(e)]));
  if (![...byEntity.values()].some((fields) => fields.length)) return records;
  return records.map((r) => {
    const fields = byEntity.get(r.entityId) ?? [];
    if (!fields.length) return r;
    const data = { ...r.data };
    for (const f of fields) data[f.id] = (f.type === "created_by" ? r.createdBy : r.updatedBy)?.name ?? "";
    return { ...r, data };
  });
}

/**
 * The record as the person saving it will be stamped: the creator too when it's new. The browser shows this at
 * once; the server stamps the same person when the save lands.
 */
export function stampRecord(
  bp: Blueprint,
  record: DataRecord,
  by: RecordActor,
  created: boolean,
): DataRecord {
  const stamped = { ...record, updatedBy: by, ...(created ? { createdBy: by } : {}) };
  return withActorValues(bp, [stamped])[0];
}

/**
 * After a save in the browser: records that are new or whose values changed are stamped with the person saving,
 * so Created by / Last edited by read right away. Unchanged records keep their object (and their stamps).
 */
export function stampChanged(
  bp: Blueprint,
  before: DataRecord[],
  after: DataRecord[],
  by: RecordActor | null | undefined,
): DataRecord[] {
  if (!by) return after;
  const was = new Map(before.map((r) => [r.id, r]));
  return after.map((r) => {
    const old = was.get(r.id);
    if (old === r) return r;
    if (!old) return stampRecord(bp, r, by, true);
    if (!editedBy(bp, old, r)) return r;
    return stampRecord(bp, { ...r, createdBy: r.createdBy ?? old.createdBy }, by, false);
  });
}

/**
 * Whether a save is someone's edit of the record: a field people fill in changed. Formulas, rollups and the stamps
 * themselves recalculating (a player's total when one of their bookings is paid) don't make the record theirs.
 */
export function editedBy(bp: Blueprint, before: DataRecord, after: DataRecord): boolean {
  if (before.entityId !== after.entityId) return true;
  const entity = bp.entities.find((e) => e.id === after.entityId);
  if (!entity) return JSON.stringify(before.data) !== JSON.stringify(after.data);
  return entity.fields.some(
    (f) =>
      f.type !== "formula" &&
      f.type !== "rollup" &&
      !ACTOR_FIELD_TYPES.has(f.type) &&
      JSON.stringify(before.data[f.id] ?? null) !== JSON.stringify(after.data[f.id] ?? null),
  );
}
