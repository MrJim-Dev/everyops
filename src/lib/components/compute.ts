import { displayKind } from "@/lib/blueprint/field-kind";
import { getEntity } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Widget } from "@/lib/blueprint/types";
import {
  type ChartPoint,
  type ChartSeries,
  chartData,
  metricOf,
  widgetRows,
  widgetValue,
} from "@/lib/engine/aggregate";
import { compareStat, startOf } from "@/lib/engine/dashboard";
import { applyFilter } from "@/lib/engine/query";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { addDays, dateKey, todayKey } from "@/lib/time";

/**
 * What layout components show, worked out from the records. Plain data only: the app draws it straight away, and the
 * server sends it to visitors of a public layout page instead of the records themselves. Every number comes from the
 * dashboard engine, so a layout and a dashboard card always agree.
 */

export type Metric = { entityId: string; op: "count" | "sum" | "avg"; fieldId?: string; filter?: string };
export type ValueKind = "money" | "number" | "percent";

export function metricWidget(title: string, m: Metric, extra: Partial<Widget> = {}): Widget {
  return {
    id: "layout_part",
    title,
    entityId: m.entityId,
    ...(m.filter ? { filter: m.filter } : {}),
    type: "stat",
    metric: { op: m.op, ...(m.fieldId ? { fieldId: m.fieldId } : {}) },
    ...extra,
  };
}

/** How a total reads: money when it adds up a money field, otherwise a number (or what the component asks). */
export function valueKind(bp: Blueprint, m: Metric, format?: ValueKind): ValueKind {
  if (format) return format;
  if (m.op === "count" || !m.fieldId) return "number";
  const field = bp.entities.find((e) => e.id === m.entityId)?.fields.find((f) => f.id === m.fieldId);
  return field && displayKind(bp, field) === "money" ? "money" : "number";
}

/** Without a currency it reads in the one on screen (the workspace or public site being shown). */
export function formatValue(kind: ValueKind, v: number, currency?: string): string {
  if (kind === "money") return formatMoney(Math.round(v), { currency });
  if (kind === "percent") return formatPercent(Math.round(v * 10) / 10);
  return formatNumber(Math.round(v * 10) / 10);
}

export type StatProps = Metric & {
  title: string;
  compare?: { dateFieldId: string; period: "day" | "week" | "month" };
  format?: ValueKind;
};
export type StatData = {
  title: string;
  value: number;
  kind: ValueKind;
  comparison?: { change: number | null; against: string; spark: number[] };
};

export function statOf(bp: Blueprint, records: DataRecord[], p: StatProps, now = new Date()): StatData {
  const widget = metricWidget(p.title, p, p.compare ? { compare: p.compare } : {});
  const c = compareStat(bp, widget, records, now);
  return {
    title: p.title,
    value: c ? c.current : widgetValue(bp, widget, records, now),
    kind: valueKind(bp, p, p.format),
    ...(c ? { comparison: { change: c.change, against: c.against, spark: c.spark } } : {}),
  };
}

export type GoalData = {
  title: string;
  description?: string;
  value: number;
  target: number;
  kind: ValueKind;
};

export function goalOf(
  bp: Blueprint,
  records: DataRecord[],
  p: Metric & { title: string; description?: string; target: number },
  now = new Date(),
): GoalData {
  return {
    title: p.title,
    ...(p.description ? { description: p.description } : {}),
    value: widgetValue(bp, metricWidget(p.title, p), records, now),
    target: p.target,
    kind: valueKind(bp, p),
  };
}

export type ChartProps = Metric & {
  title: string;
  description?: string;
  dateFieldId?: string;
  bucket?: "day" | "week" | "month";
  groupByFieldId?: string;
  splitByFieldId?: string;
};
export type ChartData = { points: ChartPoint[]; series: ChartSeries[]; kind: ValueKind };

export function chartOf(
  bp: Blueprint,
  records: DataRecord[],
  p: ChartProps,
  shape: "line" | "bar" | "area" | "donut",
  now = new Date(),
): ChartData {
  const widget = metricWidget(p.title, p, {
    type: "chart",
    chart: {
      kind: shape,
      bucket: p.bucket ?? "day",
      ...(p.dateFieldId ? { dateFieldId: p.dateFieldId } : {}),
      ...(p.groupByFieldId ? { groupByFieldId: p.groupByFieldId } : {}),
      ...(p.splitByFieldId ? { splitByFieldId: p.splitByFieldId } : {}),
    },
  });
  const { points, series } = chartData(bp, widget, records, now);
  return { points, series, kind: valueKind(bp, p) };
}

/** The last 90 days, one point a day; the chart shows the last 7, 30 or 90 of them. */
export function dailyOf(
  bp: Blueprint,
  records: DataRecord[],
  p: Metric & { title: string; dateFieldId: string; splitByFieldId?: string },
  now = new Date(),
): ChartData {
  const widget = metricWidget(p.title, p);
  const entity = getEntity(bp, p.entityId);
  const split = p.splitByFieldId ? entity.fields.find((f) => f.id === p.splitByFieldId) : undefined;
  const series = split?.options?.map((o) => ({ key: o.id, label: o.label })) ?? [
    { key: "value", label: p.title },
  ];
  const rows = widgetRows(bp, widget, records, now);
  const byDay = new Map<string, DataRecord[]>();
  for (const r of rows) {
    const start = startOf(r.data[p.dateFieldId]);
    if (start) byDay.set(dateKey(start), [...(byDay.get(dateKey(start)) ?? []), r]);
  }
  const today = todayKey(now);
  const points = Array.from({ length: 90 }, (_, i) => {
    const key = addDays(today, i - 89);
    const list = byDay.get(key) ?? [];
    const point: ChartPoint = { bucket: key, label: `${Number(key.slice(5, 7))}/${Number(key.slice(8))}` };
    for (const s of series)
      point[s.key] = metricOf(
        widget,
        split ? list.filter((r) => String(r.data[split.id] ?? "") === s.key) : list,
      );
    return point;
  });
  return { points, series, kind: valueKind(bp, p) };
}

export type Ranked = { label: string; value: number }[];

/** Categories or linked records ranked by a total; chartData's "Other" (everything past the top nine) never ranks. */
export function rankedOf(
  bp: Blueprint,
  records: DataRecord[],
  p: Metric & { title: string; groupByFieldId: string; limit: number },
  now = new Date(),
): { ranked: Ranked; kind: ValueKind } {
  const { points, kind } = chartOf(bp, records, p, "bar", now);
  const ranked = points
    .filter((pt) => pt.bucket !== "__other")
    .map((pt) => ({ label: pt.label, value: Number(pt.value ?? 0) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, p.limit);
  return { ranked, kind };
}

export type Counted = { label: string; count: number; tone?: string }[];

/** How many records have each option (or linked record) of a field. */
export function countsOf(
  bp: Blueprint,
  records: DataRecord[],
  p: { entityId: string; fieldId: string; filter?: string; title?: string },
  now = new Date(),
): Counted {
  const field = getEntity(bp, p.entityId).fields.find((f) => f.id === p.fieldId);
  const { points } = chartOf(
    bp,
    records,
    { title: p.title ?? "", entityId: p.entityId, op: "count", filter: p.filter, groupByFieldId: p.fieldId },
    "bar",
    now,
  );
  return points.map((pt) => ({
    label: pt.label,
    count: Number(pt.value ?? 0),
    ...(field?.options?.find((o) => o.id === pt.bucket)?.tone
      ? { tone: field.options.find((o) => o.id === pt.bucket)?.tone }
      : {}),
  }));
}

/** Each stage of a status field with how many records sit there. */
export function stagesOf(
  bp: Blueprint,
  records: DataRecord[],
  p: { entityId: string; statusFieldId: string; filter?: string },
  now = new Date(),
): { total: number; stages: Counted; plural: string } {
  const entity = getEntity(bp, p.entityId);
  const field = entity.fields.find((f) => f.id === p.statusFieldId);
  const rows = applyFilter(bp, entity, records, p.filter, now);
  return {
    total: rows.length,
    plural: entity.pluralName.toLowerCase(),
    stages: (field?.options ?? []).map((o) => ({
      label: o.label,
      count: rows.filter((r) => r.data[field?.id ?? ""] === o.id).length,
      tone: o.tone,
    })),
  };
}

/** How many records fall on each day (by a date, datetime or time range field). */
export function daysOf(
  bp: Blueprint,
  records: DataRecord[],
  p: { entityId: string; dateFieldId: string; filter?: string },
  now = new Date(),
): Map<string, DataRecord[]> {
  const rows = applyFilter(bp, getEntity(bp, p.entityId), records, p.filter, now);
  const map = new Map<string, DataRecord[]>();
  for (const r of rows) {
    const start = startOf(r.data[p.dateFieldId]);
    if (!start) continue;
    const key = dateKey(start);
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return map;
}
