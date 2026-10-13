import type { Blueprint, DataRecord, Entity, Sort } from "@/lib/blueprint/types";
import { isTimeRange } from "@/lib/format";
import { recordContext } from "./context";
import { run, truthy } from "./expr";

export function applyFilter(
  bp: Blueprint,
  entity: Entity,
  records: DataRecord[],
  filter: string | undefined,
  now: Date = new Date(),
): DataRecord[] {
  const own = records.filter((r) => r.entityId === entity.id);
  if (!filter) return own;
  return own.filter((r) => truthy(run(filter, recordContext(bp, entity, r.data, records, now))));
}

function sortable(value: unknown): string | number {
  if (isTimeRange(value as never)) return Date.parse((value as { start: string }).start) || 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value ?? "").toLowerCase();
}

export function sortRecords(records: DataRecord[], sort: Sort[] | undefined): DataRecord[] {
  if (!sort?.length) return records;
  return [...records].sort((a, b) => {
    for (const s of sort) {
      const av = sortable(a.data[s.fieldId]);
      const bv = sortable(b.data[s.fieldId]);
      if (av < bv) return s.dir === "asc" ? -1 : 1;
      if (av > bv) return s.dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

/** Case-insensitive text search across a record's visible values. */
export function searchRecords(records: DataRecord[], query: string, labelOf: (r: DataRecord) => string) {
  const q = query.trim().toLowerCase();
  if (!q) return records;
  return records.filter((r) => labelOf(r).toLowerCase().includes(q));
}
