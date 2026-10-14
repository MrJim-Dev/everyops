import type { Blueprint, DataRecord, Entity, Field } from "@/lib/blueprint/types";
import { isAutoReference } from "./references";

/**
 * Sequence numbers ("#1251", "BK-1002") are picked by whoever saves: a register takes the highest number it has
 * seen plus one. Two registers selling at the same moment both pick #1251, so the server renumbers a new record
 * whose number is already taken (it saves one workspace at a time, so it sees every number in use).
 */
const SEQUENCE = /^(\D{0,6}?)(\d{1,9})$/;

/** The fields of a record type that hold sequence numbers: reference fields and a register's order code. */
export function sequenceFields(bp: Blueprint, entity: Entity): Field[] {
  const orderTypes = new Set(
    bp.views.flatMap((v) => {
      if (v.type !== "checkout") return [];
      const line = bp.entities.find((e) => e.id === v.lineEntityId);
      return line?.parent ? [line.parent.entityId] : [];
    }),
  );
  return entity.fields.filter(
    (f) =>
      f.type === "text" &&
      (isAutoReference(f) || (orderTypes.has(entity.id) && f.id === entity.primaryFieldId)),
  );
}

/**
 * New records with a number already in use get the next free one (same prefix and width). Returns the records to
 * save and the ones that changed. Text that isn't a sequence number is left alone.
 */
export function renumberTaken(
  bp: Blueprint,
  stored: DataRecord[],
  incoming: DataRecord[],
): { records: DataRecord[]; changed: DataRecord[] } {
  const changed: DataRecord[] = [];
  const seen = [...stored];
  const records = incoming.map((r) => {
    const entity = bp.entities.find((e) => e.id === r.entityId);
    let next = r;
    for (const f of entity ? sequenceFields(bp, entity) : []) {
      const value = String(next.data[f.id] ?? "");
      const m = SEQUENCE.exec(value);
      if (!m) continue;
      const same = seen.filter((x) => x.entityId === r.entityId && x.id !== r.id);
      if (!same.some((x) => String(x.data[f.id] ?? "") === value)) continue;
      const highest = Math.max(
        Number(m[2]),
        ...same.map((x) => {
          const o = SEQUENCE.exec(String(x.data[f.id] ?? ""));
          return o && o[1] === m[1] ? Number(o[2]) : 0;
        }),
      );
      const number = String(highest + 1).padStart(m[2].length, "0");
      next = { ...next, data: { ...next.data, [f.id]: `${m[1]}${number}` } };
    }
    if (next !== r) changed.push(next);
    seen.push(next);
    return next;
  });
  return { records, changed };
}
