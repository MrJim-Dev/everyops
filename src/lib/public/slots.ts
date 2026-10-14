import type { Blueprint, DataRecord, FormView } from "@/lib/blueprint/types";
import { overlaps } from "@/lib/engine/availability";
import { isTimeRange } from "@/lib/format";
import { at, hhmm, minutesOf } from "@/lib/time";

export type Slot = { start: string; end: string; free: boolean };

/**
 * The bookable slots of one resource on one Manila day, for a public booking form. A slot is taken when a
 * booking with a blocking status overlaps it. Slots that have already started aren't listed at all: a day of
 * crossed-out morning hours only buries the times a visitor can still book.
 */
export function slotsFor(
  bp: Blueprint,
  records: DataRecord[],
  view: FormView,
  resourceId: string,
  day: string,
  now = new Date(),
): Slot[] | null {
  const entity = bp.entities.find((e) => e.id === view.entityId);
  const booking = entity?.booking;
  if (!entity || !booking) return null;
  const resourceField = entity.fields.find((f) => f.id === booking.resourceFieldId);
  const resourceEntity = bp.entities.find((e) => e.id === resourceField?.relation?.entityId);
  const resource = records.find((r) => r.id === resourceId && r.entityId === resourceEntity?.id);
  if (!resourceEntity || !resource) return null;
  const hours = resourceEntity.resource ?? { opensAt: "08:00", closesAt: "20:00", slotMinutes: 60 };
  const taken = records.filter((r) => {
    if (r.entityId !== entity.id || r.data[booking.resourceFieldId] !== resourceId) return false;
    const status = r.data[booking.statusFieldId];
    return (
      typeof status === "string" &&
      booking.blockingStatuses.includes(status) &&
      isTimeRange(r.data[booking.timeFieldId])
    );
  });
  const slots: Slot[] = [];
  const close = minutesOf(hours.closesAt);
  for (let m = minutesOf(hours.opensAt); m + hours.slotMinutes <= close; m += hours.slotMinutes) {
    const range = { start: at(day, hhmm(m)), end: at(day, hhmm(m + hours.slotMinutes)) };
    if (Date.parse(range.start) <= now.getTime()) continue;
    const busy = taken.some((r) =>
      overlaps(range, r.data[booking.timeFieldId] as { start: string; end: string }),
    );
    slots.push({ ...range, free: !busy });
  }
  return slots;
}
