import type { Blueprint, DataRecord, Entity, Widget } from "@/lib/blueprint/types";
import { allActions } from "./branches";

/**
 * Large record types load a recent window into the browser, and the rest stays on the server (docs/server-paging.md).
 * A type is windowed only when nothing the browser works out from every record would be wrong without its older
 * records. Totals other records keep of it (rollups) come from the server, which works them out from every record on
 * each save, and its tables page on the server.
 */

/** Record types with more records than this are windowed, when it's safe. */
export const WINDOW_AT = 5000;
/** The browser gets this many days back (by the record's date), plus everything upcoming. Month charts show 6 months. */
export const WINDOW_DAYS = 200;

/** The date a record type's window is read by: its booking time, or its first date field; none means when it was added. */
export function windowDateField(entity: Entity): string | undefined {
  return (
    entity.booking?.timeFieldId ??
    entity.fields.find((f) => f.type === "date" || f.type === "datetime" || f.type === "time_range")?.id
  );
}

const TIME_FN = /\b(is_today|is_this_week|is_this_month|is_upcoming)\s*\(/;
/** A filter that keeps only recent or upcoming records: a date function, not negated, not one side of an "or". */
const timeBound = (filter: string | undefined) =>
  !!filter && TIME_FN.test(filter) && !/!\s*is_/.test(filter) && !filter.includes("||");

/** Whether a dashboard widget shows only what falls inside the window (today, this week, the last 6 months, upcoming). */
function widgetFits(widget: Widget): boolean {
  if (widget.compare || widget.agenda) return true;
  if (widget.heatmap) return (widget.heatmap.weeks ?? 6) * 7 <= WINDOW_DAYS;
  if (widget.chart?.dateFieldId && !widget.chart.groupByFieldId) return true;
  return timeBound(widget.filter);
}

/** Why a record type can't be windowed, or null when it can. */
export function windowBlocker(bp: Blueprint, entityId: string): string | null {
  for (const w of bp.widgets) {
    if (w.entityId === entityId && !widgetFits(w)) return `the card "${w.title}" adds up all of them`;
    for (const t of w.calc?.terms ?? [])
      if (t.entityId === entityId && !timeBound(t.filter)) return `the card "${w.title}" adds up all of them`;
  }
  // Filing a record under its match (link_record) looks the match up among all of them.
  for (const rule of bp.rules)
    for (const a of allActions(rule)) {
      if (a.type !== "link_record") continue;
      const source = bp.entities.find((e) => e.id === rule.trigger.entityId);
      const link = source?.fields.find((f) => f.id === a.target.fieldId);
      if (link?.relation?.entityId === entityId)
        return `the automation "${rule.name}" looks records up among them`;
    }
  return null;
}

/** Whether a record falls in the window: its date in the last WINDOW_DAYS or later, or added or changed since. */
export function inWindow(entity: Entity, record: DataRecord, now: Date): boolean {
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const field = windowDateField(entity);
  const raw = field ? record.data[field] : undefined;
  const start =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { start?: unknown }).start : raw;
  const at = typeof start === "string" ? Date.parse(start) : Number.NaN;
  if (!Number.isNaN(at) && at >= since) return true;
  for (const t of [record.updatedAt, record.createdAt]) if (Date.parse(t) >= since) return true;
  return false;
}

/** What the browser has of a windowed type: how many there are, how many it got, and from when. */
export type WindowInfo = { total: number; loaded: number; since: string };

/**
 * The records the browser gets: every record of small types, and the window of large ones that can be windowed.
 * Returns the windowed types too, for the browser to page their tables on the server and keep their totals.
 */
export function windowRecords<T extends { record: DataRecord }>(
  bp: Blueprint,
  rows: T[],
  now: Date,
): { rows: T[]; windowed: Record<string, WindowInfo> } {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.record.entityId, (counts.get(r.record.entityId) ?? 0) + 1);
  const large = bp.entities.filter((e) => (counts.get(e.id) ?? 0) > WINDOW_AT && !windowBlocker(bp, e.id));
  if (!large.length) return { rows, windowed: {} };
  const byId = new Map(large.map((e) => [e.id, e]));
  const kept = rows.filter((r) => {
    const e = byId.get(r.record.entityId);
    return !e || inWindow(e, r.record, now);
  });
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const windowed: Record<string, WindowInfo> = {};
  for (const e of large)
    windowed[e.id] = {
      total: counts.get(e.id) ?? 0,
      loaded: kept.filter((r) => r.record.entityId === e.id).length,
      since,
    };
  return { rows: kept, windowed };
}
