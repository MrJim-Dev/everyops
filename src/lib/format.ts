import type { FieldValue, TimeRange } from "@/lib/blueprint/types";
import { at, isDateKey, zone } from "@/lib/time";

const pesoWhole = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const pesoCents = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});
const plain = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });

export function formatMoney(value: number, { signed = false } = {}): string {
  const formatter = Number.isInteger(value) ? pesoWhole : pesoCents;
  const text = formatter.format(Math.abs(value));
  if (value < 0) return `−${text}`;
  return signed && value > 0 ? `+${text}` : text;
}

export function formatNumber(value: number): string {
  return plain.format(value);
}

export function formatPercent(value: number): string {
  return `${plain.format(value)}%`;
}

/** The highest rating; ratings are whole numbers from 1 to RATING_MAX. */
export const RATING_MAX = 5;

/** A rating as stars: 4 → ★★★★☆. */
export function formatRating(value: number): string {
  const n = Math.max(0, Math.min(RATING_MAX, Math.round(value)));
  return "★".repeat(n) + "☆".repeat(RATING_MAX - n);
}

/** "4", "4/5", "★★★★" or "4 stars" as a rating from 1 to 5, or null. */
export function parseRating(text: string): number | null {
  const t = text.trim();
  const stars = (t.match(/★/g) ?? []).length;
  const n =
    stars && /^[★☆\s]+$/.test(t) ? stars : Number(/^(\d+(?:\.\d+)?)\s*(?:\/\s*5|stars?)?$/i.exec(t)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= RATING_MAX ? n : null;
}

/** Minutes as people read them: 90 → "1 h 30 min", 45 → "45 min", 120 → "2 h". */
export function formatDuration(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const text = h && m ? `${plain.format(h)} h ${m} min` : h ? `${plain.format(h)} h` : `${m} min`;
  return minutes < 0 ? `−${text}` : text;
}

/**
 * A length of time typed the usual ways, in minutes: "90" (minutes), "1:30", "1h 30m", "1 hr 30 mins", "1.5 h",
 * "2 hours", "45 min". Null when it doesn't read as one.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const clock = /^(\d+):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const parts =
    /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes))?$/.exec(
      t,
    );
  if (!parts || (!parts[1] && !parts[2])) return null;
  return Math.round(Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0));
}

const DATE_STYLES = {
  date: { weekday: "short", day: "numeric", month: "short" },
  dateYear: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
  month: { month: "long", year: "numeric" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;
const dateFormats = new Map<string, Intl.DateTimeFormat>();
/** A date formatter on the current zone's clock (the workspace's), made once per zone. */
function dateFormat(style: keyof typeof DATE_STYLES): Intl.DateTimeFormat {
  const tz = zone();
  const key = `${tz}:${style}`;
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-PH", { timeZone: tz, ...DATE_STYLES[style] });
    dateFormats.set(key, f);
  }
  return f;
}

/** Date keys ("YYYY-MM-DD") are calendar days; anchor them at noon on the workspace's clock. */
function toDate(value: string): Date {
  return isDateKey(value) ? new Date(at(value, "12:00")) : new Date(value);
}

export function formatDate(value: string, { withYear = false } = {}): string {
  return dateFormat(withYear ? "dateYear" : "date").format(toDate(value));
}

export function formatTime(value: string): string {
  return dateFormat("time")
    .format(new Date(value))
    .replace(/\s?(AM|PM)/i, " $1");
}

export function formatMonth(value: string): string {
  return dateFormat("month").format(toDate(value));
}

export function formatDateTime(value: string): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

export function formatRange(range: TimeRange): string {
  if (isDateKey(range.start)) {
    return range.start === range.end
      ? formatDate(range.start)
      : `${formatDate(range.start)} – ${formatDate(range.end)}`;
  }
  return `${formatTime(range.start)} – ${formatTime(range.end)}`;
}

export function isTimeRange(value: FieldValue | undefined): value is TimeRange {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && "start" in value && "end" in value
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}
