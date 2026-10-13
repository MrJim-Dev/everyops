import type { FieldValue, TimeRange } from "@/lib/blueprint/types";
import { isDateKey, TIME_ZONE } from "@/lib/time";

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

const dateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dateYearFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const monthFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: TIME_ZONE,
  month: "long",
  year: "numeric",
});

/** Date keys ("YYYY-MM-DD") are calendar days; anchor them at Manila noon. */
function toDate(value: string): Date {
  return isDateKey(value) ? new Date(`${value}T12:00:00+08:00`) : new Date(value);
}

export function formatDate(value: string, { withYear = false } = {}): string {
  return (withYear ? dateYearFormat : dateFormat).format(toDate(value));
}

export function formatTime(value: string): string {
  return timeFormat.format(new Date(value)).replace(/\s?(AM|PM)/i, " $1");
}

export function formatMonth(value: string): string {
  return monthFormat.format(toDate(value));
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
