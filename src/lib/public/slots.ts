import type { Blueprint, DataRecord, FormView } from "@/lib/blueprint/types";
import { overlaps } from "@/lib/engine/availability";
import { isTimeRange } from "@/lib/format";
import { at, dateKey, hhmm, minutesOf } from "@/lib/time";

export type Slot = { start: string; end: string; free: boolean };

type Hours = { opensAt: string; closesAt: string; slotMinutes: number };

/**
 * Why a visitor's picked range can't be booked, or null when it can: it must start and end on slot boundaries
 * inside opening hours on one Manila day, and cover one slot unless the form lets people book several in a row.
 */
export function slotRangeProblem(
  range: { start: string; end: string },
  hours: Hours,
  multiple: boolean,
): string | null {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "Pick a time.";
  const day = dateKey(new Date(start));
  const open = Date.parse(at(day, hours.opensAt));
  const close = Date.parse(at(day, hours.closesAt));
  const step = hours.slotMinutes * 60_000;
  if (start < open || end > close || (start - open) % step !== 0 || (end - start) % step !== 0)
    return "Pick one of the open times.";
  if (!multiple && end - start > step) return "This form books one time slot at a time.";
  return null;
}

/** A day's slots with the ones from start to end (inclusive) as one range, or null when any of them is taken. */
export function joinSlots(
  slots: Slot[],
  fromStart: string,
  toStart: string,
): { start: string; end: string } | null {
  const a = slots.findIndex((s) => s.start === fromStart);
  const b = slots.findIndex((s) => s.start === toStart);
  if (a < 0 || b < 0) return null;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const run = slots.slice(lo, hi + 1);
  // Slots are listed in order; a gap (an hour that already started) or a taken one breaks the run.
  for (let i = 0; i < run.length; i++)
    if (!run[i].free || (i > 0 && run[i - 1].end !== run[i].start)) return null;
  return { start: run[0].start, end: run[run.length - 1].end };
}

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
