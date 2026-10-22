import type { FieldValue, TimeRange } from "@/lib/blueprint/types";
import { at, isDateKey, zone } from "@/lib/time";

const plain = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 });

/**
 * Currencies a workspace can keep its money in, with the locale whose symbol reads naturally there (₱, S$, RM).
 * Money is stored as a plain number; the currency only changes how it reads. PHP is the default.
 */
export const CURRENCIES = [
  { code: "PHP", name: "Philippine peso", locale: "en-PH" },
  { code: "USD", name: "US dollar", locale: "en-US" },
  { code: "SGD", name: "Singapore dollar", locale: "en-SG" },
  { code: "MYR", name: "Malaysian ringgit", locale: "en-MY" },
  { code: "IDR", name: "Indonesian rupiah", locale: "id-ID" },
  { code: "THB", name: "Thai baht", locale: "th-TH" },
  { code: "VND", name: "Vietnamese dong", locale: "vi-VN" },
  { code: "JPY", name: "Japanese yen", locale: "ja-JP" },
  { code: "KRW", name: "South Korean won", locale: "ko-KR" },
  { code: "CNY", name: "Chinese yuan", locale: "zh-CN" },
  { code: "HKD", name: "Hong Kong dollar", locale: "en-HK" },
  { code: "TWD", name: "New Taiwan dollar", locale: "zh-TW" },
  { code: "INR", name: "Indian rupee", locale: "en-IN" },
  { code: "AUD", name: "Australian dollar", locale: "en-AU" },
  { code: "NZD", name: "New Zealand dollar", locale: "en-NZ" },
  { code: "EUR", name: "Euro", locale: "en-IE" },
  { code: "GBP", name: "British pound", locale: "en-GB" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const DEFAULT_CURRENCY: CurrencyCode = "PHP";

export const isCurrency = (code: unknown): code is CurrencyCode =>
  typeof code === "string" && CURRENCIES.some((c) => c.code === code);

/** A workspace's currency: its own when it set one, otherwise pesos. */
export const currencyOf = (holder: { currency?: string } | undefined): CurrencyCode =>
  isCurrency(holder?.currency) ? holder.currency : DEFAULT_CURRENCY;

const formatters = new Map<string, Intl.NumberFormat>();
/** Dollars outside the US read with their country, so S$400 never passes for US$400. */
const SYMBOLS: Partial<Record<CurrencyCode, string>> = {
  SGD: "S$",
  HKD: "HK$",
  AUD: "A$",
  NZD: "NZ$",
  TWD: "NT$",
};

function withSymbol(f: Intl.NumberFormat, code: CurrencyCode, value: number): string {
  const symbol = SYMBOLS[code];
  if (!symbol) return f.format(value);
  return f
    .formatToParts(value)
    .map((p) => (p.type === "currency" ? symbol : p.value))
    .join("");
}
function moneyFormat(code: CurrencyCode, cents: boolean): Intl.NumberFormat {
  const key = `${code}:${cents}`;
  let f = formatters.get(key);
  if (!f) {
    const locale = CURRENCIES.find((c) => c.code === code)?.locale ?? "en-PH";
    const base = new Intl.NumberFormat(locale, { style: "currency", currency: code });
    // Whole amounts drop the cents (₱400); others keep the currency's own decimals (yen has none).
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      ...(cents
        ? { minimumFractionDigits: base.resolvedOptions().maximumFractionDigits }
        : { maximumFractionDigits: 0 }),
    });
    formatters.set(key, f);
  }
  return f;
}

/** The symbol a money input shows before the amount: ₱, $, S$, RM. */
export function currencySymbol(code: string = DEFAULT_CURRENCY): string {
  const c = isCurrency(code) ? code : DEFAULT_CURRENCY;
  return (
    SYMBOLS[c] ??
    moneyFormat(c, false)
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ??
    c
  );
}

/** Money as people read it, in the currency named (the workspace's), pesos when none is. */
export function formatMoney(
  value: number,
  { signed = false, currency }: { signed?: boolean; currency?: string } = {},
): string {
  const code = isCurrency(currency) ? currency : DEFAULT_CURRENCY;
  const formatter = moneyFormat(code, !Number.isInteger(value));
  const text = withSymbol(formatter, code, Math.abs(value));
  if (value < 0) return `−${text}`;
  return signed && value > 0 ? `+${text}` : text;
}

const CODES = CURRENCIES.map((c) => c.code).join("|");
/** Text that shows an amount is money: a currency symbol (₱, $, €), a code (PHP, SGD) or RM / Rp. */
const MONEY_MARK = new RegExp(`\\p{Sc}|\\b(?:${CODES}|RM|Rp)\\b`, "iu");
export const looksLikeMoney = (text: string) => MONEY_MARK.test(text);

/** An amount typed or pasted with its currency ("₱1,250", "S$ 1,250.50", "RM 300", "USD 99") as plain digits. */
export function stripMoney(text: string): string {
  return (
    text
      .trim()
      // A code or RM/Rp, or the letters of S$, US$, HK$ (the $ itself goes below).
      .replace(new RegExp(`^(?:${CODES}|RM|Rp|[a-z]{1,3}(?=\\p{Sc}))\\s*`, "iu"), "")
      .replace(/[\p{Sc},\s]/gu, "")
  );
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
