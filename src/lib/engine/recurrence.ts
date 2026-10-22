import { getEntity } from "@/lib/blueprint/lookup";
import type { DataRecord, Entity, FieldValue, RecordData, WorkspaceData } from "@/lib/blueprint/types";
import { isTimeRange } from "@/lib/format";
import { addDays, at, dateKey, isDateKey, zonedParts } from "@/lib/time";
import { findConflict } from "./availability";
import { newId } from "./ids";
import { createRecord, type FieldError, updateRecord } from "./records";
import { windowDateField } from "./window";

/**
 * Recurring records: a booking every Tuesday at 7 PM, a membership fee every month. A series is ordinary records,
 * one per date, each checked and saved like one made by hand. They share two keys in their data that no field can
 * use (field ids start with a letter): @series, the series' id, and @repeat, its rule ("week:1", "month:1").
 */
export const SERIES_KEY = "@series";
export const REPEAT_KEY = "@repeat";
/** The most records one series makes: two years of weekly bookings. */
export const MAX_REPEATS = 104;

export type Every = "day" | "week" | "month";
export type Repeat = { every: Every; interval: number; count?: number; until?: string };

export const repeatText = (r: Pick<Repeat, "every" | "interval">) =>
  r.interval === 1 ? `every ${r.every}` : `every ${r.interval} ${r.every}s`;

export function readRepeat(value: FieldValue | undefined): Pick<Repeat, "every" | "interval"> | null {
  const m = typeof value === "string" ? /^(day|week|month):(\d+)$/.exec(value) : null;
  return m ? { every: m[1] as Every, interval: Number(m[2]) } : null;
}

/** The field a series steps through: the booking's time, else the type's first date, date-time or time range. */
export const seriesField = (entity: Entity) => windowDateField(entity);

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The month n months after a day, on the same day of the month, or its last day when that month is shorter. */
function addMonths(key: string, n: number, day: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = total % 12;
  return `${year}-${pad(month + 1)}-${pad(Math.min(day, daysIn(year, month)))}`;
}

/** The days a series falls on, the first one included. Stops at its count, its last day, or MAX_REPEATS. */
export function seriesDays(first: string, repeat: Repeat): string[] {
  const step = Math.max(1, Math.floor(repeat.interval || 1));
  const count = Math.min(MAX_REPEATS, repeat.count ?? MAX_REPEATS);
  const until = repeat.until && isDateKey(repeat.until) ? repeat.until : null;
  if (!repeat.count && !until) return [first];
  const day = Number(first.slice(8, 10));
  const out: string[] = [];
  for (let i = 0; out.length < count; i++) {
    const key =
      repeat.every === "month"
        ? addMonths(first, i * step, day)
        : addDays(first, i * step * (repeat.every === "week" ? 7 : 1));
    if (until && key > until) break;
    out.push(key);
  }
  return out;
}

/** The day a date, date-time or time range falls on. */
export function dayOfValue(value: FieldValue | undefined): string | null {
  const start = isTimeRange(value) ? value.start : value;
  if (typeof start !== "string" || !start) return null;
  if (isDateKey(start)) return start;
  return Number.isNaN(Date.parse(start)) ? null : dateKey(start);
}

const clock = (iso: string) => {
  const p = zonedParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

/** The same value moved to another day: the same wall-clock time there, the same length for a time range. */
export function moveToDay(value: FieldValue | undefined, day: string): FieldValue | undefined {
  if (isTimeRange(value)) {
    const start = at(day, clock(value.start));
    const length = Date.parse(value.end) - Date.parse(value.start);
    return { start, end: new Date(Date.parse(start) + length).toISOString() };
  }
  if (typeof value !== "string" || !value) return value;
  if (isDateKey(value)) return day;
  return Number.isNaN(Date.parse(value)) ? value : at(day, clock(value));
}

export type SeriesItem = { day: string; data: RecordData; clash?: DataRecord };

/** What a series would make, before saving: each day's values and, for bookings, what it would clash with. */
export function planSeries(
  ws: WorkspaceData,
  entityId: string,
  input: RecordData,
  repeat: Repeat,
): SeriesItem[] {
  const entity = getEntity(ws.blueprint, entityId);
  const fieldId = seriesField(entity);
  const first = fieldId ? dayOfValue(input[fieldId]) : null;
  if (!fieldId || !first) return [];
  const items: SeriesItem[] = [];
  const taken: DataRecord[] = [];
  for (const day of seriesDays(first, repeat)) {
    const data = { ...input, [fieldId]: moveToDay(input[fieldId], day) ?? null };
    const clash = findConflict(entity, data, [...ws.records, ...taken]);
    items.push({ day, data, clash });
    if (!clash) taken.push({ id: `planned-${day}`, entityId, data, createdAt: "", updatedAt: "" });
  }
  return items;
}

export type SeriesResult =
  | { ok: true; data: WorkspaceData; record: DataRecord; ids: string[]; skipped: string[]; notices: string[] }
  | { ok: false; errors: FieldError[] };

/**
 * Makes a series: one record per day, each through the same checks, automations and formulas as one made by hand.
 * Days that clash with a booking are skipped and returned. Without a repeat it's a single record.
 */
export function createSeries(
  ws: WorkspaceData,
  entityId: string,
  input: RecordData,
  repeat: Repeat | null,
  now: Date = new Date(),
): SeriesResult {
  const items = repeat ? planSeries(ws, entityId, input, repeat) : [];
  if (items.length < 2) {
    const one = createRecord(ws, entityId, input, now);
    return one.ok ? { ...one, ids: [one.record.id], skipped: [] } : one;
  }
  const series = newId("series");
  const rule = `${repeat?.every}:${Math.max(1, Math.floor(repeat?.interval || 1))}`;
  let data = ws;
  const ids: string[] = [];
  const skipped: string[] = [];
  const notices: string[] = [];
  let first: DataRecord | null = null;
  for (const item of items) {
    if (item.clash) {
      skipped.push(item.day);
      continue;
    }
    const result = createRecord(
      data,
      entityId,
      { ...item.data, [SERIES_KEY]: series, [REPEAT_KEY]: rule },
      now,
    );
    if (!result.ok) {
      // The first day's errors are the form's (a required field); a later day that fails is skipped like a clash.
      if (!first) return result;
      skipped.push(item.day);
      continue;
    }
    data = result.data;
    first ??= result.record;
    ids.push(result.record.id);
    for (const n of result.notices) if (!notices.includes(n)) notices.push(n);
  }
  if (!first) {
    const day = items[0]?.day ?? "";
    return { ok: false, errors: [{ message: `Every date clashes with another booking, starting ${day}` }] };
  }
  return { ok: true, data, record: first, ids, skipped, notices };
}

/** The records of a record's series in date order, and where it falls among them. */
export function seriesOf(records: DataRecord[], record: DataRecord, entity: Entity) {
  const id = record.data[SERIES_KEY];
  if (typeof id !== "string" || !id) return null;
  const fieldId = seriesField(entity);
  const day = (r: DataRecord) => (fieldId ? (dayOfValue(r.data[fieldId]) ?? "") : "");
  const members = records
    .filter((r) => r.entityId === record.entityId && r.data[SERIES_KEY] === id)
    .sort((a, b) => day(a).localeCompare(day(b)) || a.createdAt.localeCompare(b.createdAt));
  const index = members.findIndex((r) => r.id === record.id);
  return {
    id,
    repeat: readRepeat(record.data[REPEAT_KEY]),
    members,
    index,
    following: members.slice(index + 1),
  };
}

/**
 * An edit to a record and the rest of its series after it. Other fields are copied as they are; a new date or time
 * moves each later record by the same number of days, to the new time of day and length.
 */
export function updateFollowing(
  ws: WorkspaceData,
  record: DataRecord,
  patch: RecordData,
  now: Date = new Date(),
): SeriesResult {
  const entity = getEntity(ws.blueprint, record.entityId);
  const series = seriesOf(ws.records, record, entity);
  const fieldId = seriesField(entity);
  const first = updateRecord(ws, record.id, patch, now);
  if (!first.ok || !series) return first.ok ? { ...first, ids: [record.id], skipped: [] } : first;
  const oldDay = fieldId ? dayOfValue(record.data[fieldId]) : null;
  const newValue = fieldId && fieldId in patch ? patch[fieldId] : undefined;
  const newDay = newValue !== undefined ? dayOfValue(newValue) : null;
  const shift = oldDay && newDay ? Math.round((Date.parse(newDay) - Date.parse(oldDay)) / 86_400_000) : 0;
  let data = first.data;
  const ids = [record.id];
  const notices = [...first.notices];
  for (const later of series.following) {
    const own: RecordData = { ...patch };
    if (fieldId && newValue !== undefined) {
      const day = dayOfValue(later.data[fieldId]);
      own[fieldId] = day ? (moveToDay(newValue, addDays(day, shift)) ?? null) : newValue;
    }
    const result = updateRecord(data, later.id, own, now);
    if (!result.ok) {
      const day = fieldId ? dayOfValue(later.data[fieldId]) : later.id;
      return {
        ok: false,
        errors: [{ message: `Couldn't change ${day}: ${result.errors[0]?.message ?? "it didn't save"}` }],
      };
    }
    data = result.data;
    ids.push(later.id);
    for (const n of result.notices) if (!notices.includes(n)) notices.push(n);
  }
  return { ok: true, data, record: first.record, ids, skipped: [], notices };
}
