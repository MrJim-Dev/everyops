/**
 * Time helpers pinned to Asia/Manila. The Philippines has no daylight saving,
 * so a fixed +08:00 offset is exact and keeps date math dependency free.
 */
export const TIME_ZONE = "Asia/Manila";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ManilaParts = {
  year: number;
  month: number; // 0-11
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
};

export function manilaParts(value: string | Date): ManilaParts {
  const shifted = new Date(new Date(value).getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for the Manila calendar day of a date-time or date key. */
export function dateKey(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const p = manilaParts(value);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

export function todayKey(now: Date = new Date()): string {
  return dateKey(now);
}

export function addDays(key: string, days: number): string {
  const base = Date.parse(`${key}T00:00:00Z`);
  const next = new Date(base + days * DAY_MS);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

/** ISO instant for a Manila wall-clock time, e.g. at("2026-10-13", "18:00"). */
export function at(key: string, hhmm: string): string {
  return new Date(`${key}T${hhmm}:00+08:00`).toISOString();
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function hoursBetween(startIso: string, endIso: string): number {
  return (Date.parse(endIso) - Date.parse(startIso)) / (60 * 60 * 1000);
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function startOfMonthKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}
