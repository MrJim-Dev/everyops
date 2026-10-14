import type { Blueprint, DataRecord, FieldValue, WorkspaceData } from "@/lib/blueprint/types";
import { computeAll } from "@/lib/engine/compute";
import { addDays, daysBetween, todayKey } from "@/lib/time";

const DAY_MS = 86_400_000;
const isDateKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);

function shiftValue(value: FieldValue, days: number): FieldValue {
  if (isDateKey(value)) return addDays(value, days);
  if (isIso(value)) return new Date(Date.parse(value) + days * DAY_MS).toISOString();
  if (value && typeof value === "object" && !Array.isArray(value) && "start" in value)
    return { start: shiftValue(value.start, days) as string, end: shiftValue(value.end, days) as string };
  return value;
}

/**
 * Sample data is saved once with the day it was built. Moving every date by the days since then
 * keeps "today's bookings" and "this month's sales" looking current whenever a template is used.
 */
export function shiftRecords(bp: Blueprint, records: DataRecord[], builtOn: string, now = new Date()) {
  const days = daysBetween(builtOn, todayKey(now));
  if (!days) return records;
  const dated = new Map(
    bp.entities.map((e) => [
      e.id,
      new Set(
        e.fields
          .filter((f) => f.type === "date" || f.type === "datetime" || f.type === "time_range")
          .map((f) => f.id),
      ),
    ]),
  );
  return records.map((r) => {
    const fields = dated.get(r.entityId);
    const data = { ...r.data };
    if (fields) for (const id of fields) if (id in data) data[id] = shiftValue(data[id], days);
    return {
      ...r,
      data,
      createdAt: shiftValue(r.createdAt, days) as string,
      updatedAt: shiftValue(r.updatedAt, days) as string,
    };
  });
}

/** A saved template brought up to today, with formulas recomputed. */
export function freshSample(
  blueprint: Blueprint,
  records: DataRecord[],
  builtOn: string,
  workspaceName: string,
  now = new Date(),
): WorkspaceData {
  const bp = { ...blueprint, version: 1, workspaceName };
  return { blueprint: bp, records: computeAll(bp, shiftRecords(bp, records, builtOn, now), now) };
}

const yearOf = (v: unknown): number | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? Number(v.slice(0, 4)) : null;

/** The same moment some whole years later (Feb 29 becomes Feb 28 in a year without one). */
function plusYears(value: string, years: number): string {
  if (isDateKey(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const day = Math.min(d, new Date(Date.UTC(y + years, m, 0)).getUTCDate());
    return `${y + years}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const at = new Date(value);
  const day = at.getUTCDate();
  at.setUTCDate(1);
  at.setUTCFullYear(at.getUTCFullYear() + years);
  at.setUTCDate(Math.min(day, new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate()));
  return at.toISOString();
}

/**
 * Gemini sometimes writes sample records in the wrong year: the month and day it was asked for ("around today"), but
 * 2023, sometimes for only some fields (a payroll run in 2023 next to attendance in 2026). Field by field: when a
 * date field's newest value is in a recent past year and moving it to this year lands it near today, that field's
 * dates from that year (and the one before, for samples crossing New Year) move forward by whole years, and so does
 * that year written in the same record's text ("Oct 1-15, 2023" as a payroll period's name). Dates meant to be old
 * stay: birthdays (years back) and hire dates whose newest value isn't near today. Record stamps stay too.
 */
export function samplesThisYear(
  bp: Blueprint,
  records: DataRecord[],
  now = new Date(),
): { records: DataRecord[]; fields: number } {
  const thisYear = now.getUTCFullYear();
  const startOf = (v: unknown): string | null =>
    typeof v === "string"
      ? v
      : v && typeof v === "object" && !Array.isArray(v) && "start" in v
        ? String((v as { start: string }).start)
        : null;
  /** Per record type and date field: how many years its dates move, if any. */
  const moves = new Map<string, number>();
  for (const e of bp.entities)
    for (const f of e.fields) {
      if (f.type !== "date" && f.type !== "datetime" && f.type !== "time_range") continue;
      const values = records
        .filter((r) => r.entityId === e.id)
        .map((r) => startOf(r.data[f.id]))
        .filter((v): v is string => !!v && yearOf(v) !== null);
      if (!values.length) continue;
      const newest = values.sort().at(-1) as string;
      const year = yearOf(newest) as number;
      const shift = thisYear - year;
      if (shift <= 0 || shift > 5) continue;
      const landsAt = Date.parse(plusYears(newest.length === 10 ? `${newest}T12:00:00Z` : newest, shift));
      if (Math.abs(landsAt - now.getTime()) <= 120 * DAY_MS) moves.set(`${e.id}.${f.id}`, shift);
    }
  if (!moves.size) return { records, fields: 0 };
  const texts = new Map(
    bp.entities.map((e) => [
      e.id,
      e.fields.filter((f) => f.type === "text" || f.type === "long_text").map((f) => f.id),
    ]),
  );
  /** Moves one date value, noting each year it moved from and to. */
  const move = (v: FieldValue, shift: number, years: Map<number, number>): FieldValue => {
    const stale = (x: unknown) => {
      const y = yearOf(x);
      if (y === null || y < thisYear - shift - 1) return false;
      years.set(y, y + shift);
      return true;
    };
    if (typeof v === "string") return stale(v) ? plusYears(v, shift) : v;
    if (v && typeof v === "object" && !Array.isArray(v) && "start" in v)
      return stale(v.start) ? { start: plusYears(v.start, shift), end: plusYears(v.end, shift) } : v;
    return v;
  };
  return {
    fields: moves.size,
    records: records.map((r) => {
      let data: DataRecord["data"] | null = null;
      const years = new Map<number, number>();
      for (const id of Object.keys(r.data)) {
        const shift = moves.get(`${r.entityId}.${id}`);
        if (!shift) continue;
        data ??= { ...r.data };
        data[id] = move(r.data[id], shift, years);
      }
      if (data && years.size)
        for (const id of texts.get(r.entityId) ?? []) {
          const v = data[id];
          if (typeof v === "string")
            data[id] = v.replace(/\b(19|20)\d{2}\b/g, (y) => String(years.get(Number(y)) ?? y));
        }
      return data ? { ...r, data } : r;
    }),
  };
}
