import { findRecord, getEntity, recordTitle } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, FieldValue, Widget } from "@/lib/blueprint/types";
import { isTimeRange } from "@/lib/format";
import { addDays, dateKey, manilaParts, startOfMonthKey, todayKey } from "@/lib/time";
import { applyFilter } from "./query";

const numberOf = (v: FieldValue | undefined) => (typeof v === "number" ? v : Number(v) || 0);

export function metricOf(widget: Widget, rows: DataRecord[]): number {
  const { op, fieldId } = widget.metric;
  if (op === "count") return rows.length;
  const values = rows.map((r) => numberOf(fieldId ? r.data[fieldId] : 0));
  const sum = values.reduce((a, b) => a + b, 0);
  return op === "sum" ? sum : values.length ? sum / values.length : 0;
}

export function widgetRows(bp: Blueprint, widget: Widget, records: DataRecord[], now = new Date()) {
  return applyFilter(bp, getEntity(bp, widget.entityId), records, widget.filter, now);
}

export function widgetValue(bp: Blueprint, widget: Widget, records: DataRecord[], now = new Date()) {
  return metricOf(widget, widgetRows(bp, widget, records, now));
}

export type ChartSeries = { key: string; label: string };
export type ChartPoint = { bucket: string; label: string } & Record<string, number | string>;

function keyOf(value: FieldValue | undefined): string | null {
  if (isTimeRange(value ?? null)) return dateKey((value as { start: string }).start);
  return typeof value === "string" ? dateKey(value) : null;
}

const MAX_CATEGORIES = 10;

/**
 * One point per category of a field: its options in order, or linked records and plain values ranked
 * by size (the smallest folded into "Other"). Used by bar charts and donuts that compare groups.
 */
function categoryData(
  bp: Blueprint,
  widget: Widget,
  rows: DataRecord[],
  records: DataRecord[],
  series: ChartSeries[],
  splitId: string | undefined,
): ChartPoint[] {
  const entity = getEntity(bp, widget.entityId);
  const field = entity.fields.find((f) => f.id === widget.chart?.groupByFieldId);
  if (!field) return [];
  const target = field.relation ? bp.entities.find((e) => e.id === field.relation?.entityId) : undefined;
  const labelOf = (key: string) => {
    const option = field.options?.find((o) => o.id === key);
    if (option) return option.label;
    const linked = target ? findRecord(records, key) : undefined;
    if (target && linked) return recordTitle(target, linked);
    return key || "None";
  };
  const points = new Map<string, ChartPoint>();
  for (const o of field.options ?? []) {
    const point: ChartPoint = { bucket: o.id, label: o.label };
    for (const s of series) point[s.key] = 0;
    points.set(o.id, point);
  }
  for (const row of rows) {
    const raw = row.data[field.id];
    const keys = Array.isArray(raw)
      ? raw.map(String)
      : [raw === undefined || raw === null ? "" : String(raw)];
    for (const key of keys) {
      let point = points.get(key);
      if (!point) {
        if (field.options) continue;
        point = { bucket: key, label: labelOf(key) };
        for (const s of series) point[s.key] = 0;
        points.set(key, point);
      }
      const seriesKey = splitId ? String(row.data[splitId] ?? "") : "value";
      if (!(seriesKey in point)) continue;
      const amount =
        widget.metric.op === "count"
          ? 1
          : numberOf(widget.metric.fieldId ? row.data[widget.metric.fieldId] : 0);
      point[seriesKey] = Number(point[seriesKey]) + Math.abs(amount);
    }
  }
  const total = (p: ChartPoint) => series.reduce((a, s) => a + Number(p[s.key] ?? 0), 0);
  const list = [...points.values()];
  if (field.options) return list;
  list.sort((a, b) => total(b) - total(a));
  if (list.length <= MAX_CATEGORIES) return list;
  const other: ChartPoint = { bucket: "__other", label: "Other" };
  for (const s of series)
    other[s.key] = list.slice(MAX_CATEGORIES - 1).reduce((a, p) => a + Number(p[s.key] ?? 0), 0);
  return [...list.slice(0, MAX_CATEGORIES - 1), other];
}

/**
 * Buckets a widget's records by date (every day of the current month, or the last six months) or, with
 * groupByFieldId, by category. Optionally splits into one series per select option.
 */
export function chartData(
  bp: Blueprint,
  widget: Widget,
  records: DataRecord[],
  now = new Date(),
): { points: ChartPoint[]; series: ChartSeries[] } {
  const chart = widget.chart;
  if (!chart) return { points: [], series: [] };
  const entity = getEntity(bp, widget.entityId);
  const rows = widgetRows(bp, widget, records, now);
  const split = chart.splitByFieldId ? entity.fields.find((f) => f.id === chart.splitByFieldId) : undefined;
  const series: ChartSeries[] = split?.options
    ? split.options.map((o) => ({ key: o.id, label: o.label }))
    : [{ key: "value", label: widget.title }];

  if (chart.groupByFieldId)
    return { points: categoryData(bp, widget, rows, records, series, split?.id), series };
  const dateFieldId = chart.dateFieldId;
  if (!dateFieldId) return { points: [], series };

  const today = todayKey(now);
  const buckets: { bucket: string; label: string }[] = [];
  if (chart.bucket === "month") {
    const p = manilaParts(now);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(p.year, p.month - i, 1));
      const key = d.toISOString().slice(0, 7);
      buckets.push({ bucket: key, label: d.toLocaleString("en-PH", { month: "short", timeZone: "UTC" }) });
    }
  } else {
    for (let key = startOfMonthKey(today); key <= today; key = addDays(key, 1)) {
      buckets.push({ bucket: key, label: String(Number(key.slice(8))) });
    }
  }

  const points: ChartPoint[] = buckets.map((b) => {
    const point: ChartPoint = { ...b };
    for (const s of series) point[s.key] = 0;
    return point;
  });
  const index = new Map(points.map((p) => [p.bucket, p]));
  for (const row of rows) {
    const key = keyOf(row.data[dateFieldId]);
    if (!key) continue;
    const point = index.get(chart.bucket === "month" ? key.slice(0, 7) : key);
    if (!point) continue;
    const seriesKey = split ? String(row.data[split.id] ?? "") : "value";
    if (!(seriesKey in point)) continue;
    const amount =
      widget.metric.op === "count"
        ? 1
        : numberOf(widget.metric.fieldId ? row.data[widget.metric.fieldId] : 0);
    point[seriesKey] = Number(point[seriesKey]) + Math.abs(amount);
  }
  return { points, series };
}
