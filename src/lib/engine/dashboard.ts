import { getEntity } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, FieldValue, Widget } from "@/lib/blueprint/types";
import { isTimeRange } from "@/lib/format";
import { addDays, dateKey, isDateKey, todayKey, zonedParts } from "@/lib/time";
import { metricOf, widgetRows } from "./aggregate";

/** When a record happens: the start of a time range, a date-time, or a plain date. */
export function startOf(value: FieldValue | undefined): string | null {
  if (isTimeRange(value ?? null)) return (value as { start: string }).start;
  return typeof value === "string" && value ? value : null;
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;

export type Comparison = {
  current: number;
  previous: number;
  /** Change as a fraction (0.18 is up 18%); null when the previous period had nothing to compare with. */
  change: number | null;
  /** "yesterday", "the previous 7 days" or "the previous 30 days". */
  against: string;
  /** Daily values ending today, for a sparkline. */
  spark: number[];
};

/** A stat's value for the current period next to the period before it. */
export function compareStat(
  bp: Blueprint,
  widget: Widget,
  records: DataRecord[],
  now = new Date(),
): Comparison | null {
  const compare = widget.compare;
  if (!compare) return null;
  const rows = widgetRows(bp, widget, records, now);
  const today = todayKey(now);
  const byDay = new Map<string, DataRecord[]>();
  for (const row of rows) {
    const start = startOf(row.data[compare.dateFieldId]);
    if (!start) continue;
    const key = dateKey(start);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }
  const between = (from: string, to: string) => {
    const list: DataRecord[] = [];
    for (let k = from; k <= to; k = addDays(k, 1)) list.push(...(byDay.get(k) ?? []));
    return metricOf(widget, list);
  };
  const days = PERIOD_DAYS[compare.period];
  const current = between(addDays(today, 1 - days), today);
  const previous = between(addDays(today, 1 - 2 * days), addDays(today, -days));
  const sparkDays = compare.period === "month" ? 30 : 14;
  const spark = Array.from({ length: sparkDays }, (_, i) => {
    const key = addDays(today, i - sparkDays + 1);
    return metricOf(widget, byDay.get(key) ?? []);
  });
  return {
    current,
    previous,
    change: previous ? (current - previous) / Math.abs(previous) : null,
    against: compare.period === "day" ? "yesterday" : `the previous ${days} days`,
    spark,
  };
}

export type AgendaItem = { record: DataRecord; start: string; end?: string; allDay: boolean; past: boolean };
export type AgendaDay = { day: string; items: AgendaItem[] };

/** What's on today and the next few days, sorted by time. Today is always listed, even when empty. */
export function agendaDays(
  bp: Blueprint,
  widget: Widget,
  records: DataRecord[],
  now = new Date(),
): AgendaDay[] {
  const config = widget.agenda;
  if (!config) return [];
  const today = todayKey(now);
  const last = addDays(today, Math.max(1, config.days ?? 1) - 1);
  const groups = new Map<string, AgendaItem[]>([[today, []]]);
  for (const record of widgetRows(bp, widget, records, now)) {
    const value = record.data[config.dateFieldId];
    const start = startOf(value);
    if (!start) continue;
    const day = dateKey(start);
    if (day < today || day > last) continue;
    const end = isTimeRange(value ?? null) ? (value as { end: string }).end : undefined;
    const allDay = isDateKey(start);
    const past = allDay ? false : new Date(end ?? start).getTime() < now.getTime();
    groups.set(day, [...(groups.get(day) ?? []), { record, start, end, allDay, past }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({
      day,
      items: items.sort((a, b) =>
        a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1,
      ),
    }));
}

export type Heatmap = {
  /** Monday first. */
  days: string[];
  hours: number[];
  /** cells[day][hourIndex] */
  cells: number[][];
  max: number;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Weekday by hour over the last few weeks. A booking from 6 to 8 PM counts toward both hours it covers;
 * a sum (revenue) is split evenly across them.
 */
export function heatmapData(bp: Blueprint, widget: Widget, records: DataRecord[], now = new Date()): Heatmap {
  const config = widget.heatmap;
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  if (config) {
    const today = todayKey(now);
    const from = addDays(today, 1 - 7 * Math.max(1, config.weeks ?? 8));
    for (const row of widgetRows(bp, widget, records, now)) {
      const value = row.data[config.dateFieldId];
      const start = startOf(value);
      if (!start || isDateKey(start)) continue;
      const day = dateKey(start);
      if (day < from || day > today) continue;
      const end = isTimeRange(value ?? null) ? (value as { end: string }).end : undefined;
      const first = new Date(start).getTime();
      const hours = end ? Math.max(1, Math.ceil((new Date(end).getTime() - first) / 3_600_000)) : 1;
      const amount = metricOf(widget, [row]);
      const share = widget.metric.op === "count" ? 1 : amount / hours;
      for (let h = 0; h < hours; h++) {
        const p = zonedParts(new Date(first + h * 3_600_000));
        grid[(p.weekday + 6) % 7][p.hour] += share;
      }
    }
  }
  const used = grid[0].map((_, h) => grid.some((d) => d[h] > 0));
  const firstHour = used.indexOf(true);
  const lastHour = used.lastIndexOf(true);
  const hours =
    firstHour < 0
      ? Array.from({ length: 12 }, (_, i) => i + 8)
      : Array.from({ length: lastHour - firstHour + 1 }, (_, i) => i + firstHour);
  const cells = grid.map((d) => hours.map((h) => d[h]));
  return { days: DAY_LABELS, hours, cells, max: Math.max(0, ...cells.flat()) };
}

/** True when the field holds a moment in time (needed for hours) rather than just a day. */
export function hasTime(bp: Blueprint, widget: Widget, fieldId: string) {
  const field = getEntity(bp, widget.entityId).fields.find((f) => f.id === fieldId);
  if (!field) return false;
  if (field.type === "time_range") return field.range !== "dates";
  return field.type === "datetime";
}
