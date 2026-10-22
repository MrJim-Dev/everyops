/**
 * Time helpers in a workspace's time zone. Every date, schedule and "today" in a workspace is read on its own clock:
 * Asia/Manila unless the owner picked another (Settings → General). Real zones come from the platform's time zone
 * database, so daylight saving is handled; Manila (no daylight saving) keeps its fixed +08:00 fast path.
 *
 * Which zone applies is found by zone(): the server sets it per request from the workspace (src/server/zone.ts, an
 * AsyncLocalStorage so concurrent requests never share it), and the browser sets it for the workspace or public site
 * on screen. Every helper also takes the zone explicitly.
 */
export const DEFAULT_TIME_ZONE = "Asia/Manila";
/** The default zone. Prefer zone(), which is the workspace's. */
export const TIME_ZONE = DEFAULT_TIME_ZONE;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Zones owners can pick, JAPAC first. Any IANA name works where code passes one. */
export const TIME_ZONES = [
  { id: "Asia/Manila", label: "Manila (GMT+8)" },
  { id: "Asia/Singapore", label: "Singapore (GMT+8)" },
  { id: "Asia/Kuala_Lumpur", label: "Kuala Lumpur (GMT+8)" },
  { id: "Asia/Hong_Kong", label: "Hong Kong (GMT+8)" },
  { id: "Asia/Taipei", label: "Taipei (GMT+8)" },
  { id: "Asia/Shanghai", label: "Shanghai (GMT+8)" },
  { id: "Australia/Perth", label: "Perth (GMT+8)" },
  { id: "Asia/Jakarta", label: "Jakarta (GMT+7)" },
  { id: "Asia/Bangkok", label: "Bangkok (GMT+7)" },
  { id: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh City (GMT+7)" },
  { id: "Asia/Tokyo", label: "Tokyo (GMT+9)" },
  { id: "Asia/Seoul", label: "Seoul (GMT+9)" },
  { id: "Asia/Kolkata", label: "India (GMT+5:30)" },
  { id: "Asia/Dubai", label: "Dubai (GMT+4)" },
  { id: "Australia/Sydney", label: "Sydney (daylight saving)" },
  { id: "Pacific/Auckland", label: "Auckland (daylight saving)" },
  { id: "Europe/London", label: "London (daylight saving)" },
  { id: "America/New_York", label: "New York (daylight saving)" },
  { id: "America/Los_Angeles", label: "Los Angeles (daylight saving)" },
  { id: "UTC", label: "UTC" },
] as const;

const known = new Map<string, boolean>();
/** Whether a name is a time zone this platform knows ("Asia/Singapore"). */
export function isTimeZone(name: unknown): name is string {
  if (typeof name !== "string" || !name || name.length > 64) return false;
  let ok = known.get(name);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: name });
      ok = true;
    } catch {
      ok = false;
    }
    known.set(name, ok);
  }
  return ok;
}

/** A zone's short name for people: "Tokyo", "Ho Chi Minh City", "UTC". */
export const zoneName = (tz: string) => tz.split("/").pop()?.replaceAll("_", " ") ?? tz;

/** A workspace's time zone: its own when it set a valid one, otherwise Manila. */
export const timeZoneOf = (holder: { timeZone?: string } | undefined): string =>
  isTimeZone(holder?.timeZone) ? holder.timeZone : DEFAULT_TIME_ZONE;

let serverZone: () => string | undefined = () => undefined;
let browserZone: string | undefined;
/** The server's per-request zone (an AsyncLocalStorage read), installed once by src/server/zone.ts. */
export function setZoneSource(read: () => string | undefined) {
  serverZone = read;
}
/** The zone of the workspace or public site on screen. Browser only: on the server zones are per request. */
export function setBrowserZone(name: string | undefined) {
  if (typeof window !== "undefined") browserZone = isTimeZone(name) ? name : undefined;
}
/** The zone dates are read in right now: the request's workspace, the one on screen, or Manila. */
export function zone(): string {
  return serverZone() ?? browserZone ?? DEFAULT_TIME_ZONE;
}

export type ZonedParts = {
  year: number;
  month: number; // 0-11
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
};

const partFormats = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** A moment's calendar day, time and weekday on a zone's clock. */
export function zonedParts(value: string | Date, tz: string = zone()): ZonedParts {
  const ms = new Date(value).getTime();
  if (tz === DEFAULT_TIME_ZONE) {
    const shifted = new Date(ms + MANILA_OFFSET_MS);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth(),
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      weekday: shifted.getUTCDay(),
    };
  }
  let f = partFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    partFormats.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(ms).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** How far a zone's clock is ahead of UTC at a moment, in milliseconds (+8 h for Manila). */
function offsetAt(tz: string, ms: number): number {
  if (tz === DEFAULT_TIME_ZONE) return MANILA_OFFSET_MS;
  const p = zonedParts(new Date(ms), tz);
  return Date.UTC(p.year, p.month, p.day, p.hour, p.minute) - Math.floor(ms / 60_000) * 60_000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A zone's offset from UTC at a moment, as "+08:00" or "-04:00" (for prompts and RFC 3339 times). */
export function utcOffset(tz: string = zone(), now: Date = new Date()): string {
  const minutes = Math.round(offsetAt(tz, now.getTime()) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "YYYY-MM-DD" for the calendar day of a date-time (on the zone's clock) or a date key. */
export function dateKey(value: string | Date, tz: string = zone()): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const p = zonedParts(value, tz);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

export function todayKey(now: Date = new Date(), tz: string = zone()): string {
  return dateKey(now, tz);
}

export function addDays(key: string, days: number): string {
  const base = Date.parse(`${key}T00:00:00Z`);
  const next = new Date(base + days * DAY_MS);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

/**
 * ISO instant for a wall-clock time on the zone's clock, e.g. at("2026-10-13", "18:00"). In a daylight saving gap
 * (a time that doesn't exist that night) it lands just after the jump.
 */
export function at(key: string, hhmm: string, tz: string = zone()): string {
  const [y, m, d] = key.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const first = wall - offsetAt(tz, wall);
  const second = wall - offsetAt(tz, first);
  // A time that exists reads back as asked (in the repeated hour of a fall-back night, the first of the two). One
  // in a spring-forward gap doesn't; the first guess is then the moment just after the jump.
  const p = zonedParts(new Date(second), tz);
  const exact = p.hour === h && p.minute === mi;
  return new Date(exact ? second : first).toISOString();
}

/** "YYYY-MM-DDTHH:MM" as written on the zone's clock (a datetime-local input's value), as an ISO instant. */
export function fromLocal(text: string, tz: string = zone()): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text.trim());
  return m ? at(m[1], m[2], tz) : null;
}

/** An instant as "YYYY-MM-DDTHH:MM" on the zone's clock (for datetime-local inputs and spreadsheets). */
export function toLocal(value: string | Date, tz: string = zone()): string {
  const p = zonedParts(value, tz);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
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
