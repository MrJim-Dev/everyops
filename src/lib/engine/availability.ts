import { findEntity, findRecord } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, RecordData, TimeRange } from "@/lib/blueprint/types";
import { isTimeRange } from "@/lib/format";

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}

/**
 * For booking entities: returns the record that already holds the same
 * resource at an overlapping time, if any. Cancelled bookings don't block.
 */
export function findConflict(
  entity: Entity,
  data: RecordData,
  records: DataRecord[],
  ignoreId?: string,
): DataRecord | undefined {
  const booking = entity.booking;
  if (!booking) return undefined;
  const range = data[booking.timeFieldId];
  const resource = data[booking.resourceFieldId];
  const status = data[booking.statusFieldId];
  if (!isTimeRange(range) || typeof resource !== "string") return undefined;
  if (typeof status === "string" && !booking.blockingStatuses.includes(status)) return undefined;

  return records.find((r) => {
    if (r.entityId !== entity.id || r.id === ignoreId) return false;
    const otherRange = r.data[booking.timeFieldId];
    const otherStatus = r.data[booking.statusFieldId];
    return (
      r.data[booking.resourceFieldId] === resource &&
      typeof otherStatus === "string" &&
      booking.blockingStatuses.includes(otherStatus) &&
      isTimeRange(otherRange) &&
      overlaps(range, otherRange)
    );
  });
}

export function resourceLabel(bp: Blueprint, entity: Entity, data: RecordData, records: DataRecord[]) {
  const booking = entity.booking;
  if (!booking) return "";
  const field = entity.fields.find((f) => f.id === booking.resourceFieldId);
  const resourceEntity = field?.relation ? findEntity(bp, field.relation.entityId) : undefined;
  const id = data[booking.resourceFieldId];
  const record = typeof id === "string" ? findRecord(records, id) : undefined;
  if (!record || !resourceEntity) return "";
  return String(record.data[resourceEntity.primaryFieldId] ?? "");
}
