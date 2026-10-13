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
