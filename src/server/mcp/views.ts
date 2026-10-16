import { recordTitle } from "@/lib/blueprint/lookup";
import type {
  Blueprint,
  DataRecord,
  Entity,
  FieldValue,
  FormView,
  System,
  View,
  Widget,
} from "@/lib/blueprint/types";
import { parseCanvas } from "@/lib/canvas/model";
import { chartData, metricOf, widgetRows, widgetValue } from "@/lib/engine/aggregate";
import { agendaDays, compareStat, heatmapData } from "@/lib/engine/dashboard";
import { metricFormatter } from "@/lib/engine/metric-format";
import { applyFilter, sortRecords } from "@/lib/engine/query";
import { formatDate, formatRange, isTimeRange } from "@/lib/format";
import { resolveLayout } from "@/lib/public/layout";
import { formatCell, type PageDocs, resolveBlocks } from "@/lib/public/resolve";
import { daysFor, slotsFor } from "@/lib/public/slots";
import { addDays, dateKey, todayKey } from "@/lib/time";

/**
 * What an AI agent sees of a workspace's pages over MCP: each tab's settings (describeView), what it shows right now
 * (readView: the rows of a table or board with its own filter and sort, the events of a calendar, a layout page's
 * worked-out parts) and a page's dashboard cards (readDashboard). Numbers come from the same engine the app draws
 * with, so an agent never disagrees with the screen.
 */

export type ReadOptions = {
  limit?: number;
  offset?: number;
  /** Calendars and schedules: first and last day (YYYY-MM-DD, Manila). */
  from?: string;
  to?: string;
  now?: Date;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 200;
const MAX_TEXT = 60_000;

const entityOf = (bp: Blueprint, id: string | undefined) => bp.entities.find((e) => e.id === id);
const pageOf = (bp: Blueprint, viewId: string) => bp.systems.find((s) => s.viewIds.includes(viewId));
const fieldName = (entity: Entity | undefined, id: string | undefined) =>
  entity?.fields.find((f) => f.id === id)?.name ?? id;

/** One record as an agent reads it: its id, its title and each named field as the app shows it (text). */
export function rowOf(
  bp: Blueprint,
  records: DataRecord[],
  entity: Entity,
  r: DataRecord,
  fieldIds?: string[],
) {
  const ids = fieldIds?.length ? fieldIds : entity.fields.map((f) => f.id);
  const values: Record<string, string> = {};
  for (const id of ids) {
    const field = entity.fields.find((f) => f.id === id);
    if (!field) continue;
    const text = formatCell(bp, records, field, r.data[id]).text;
    if (text) values[id] = text;
  }
  return { id: r.id, title: recordTitle(entity, r), values };
}

const columnsOf = (entity: Entity, fieldIds: string[]) =>
  fieldIds.flatMap((id) => {
    const f = entity.fields.find((x) => x.id === id);
    return f ? [{ id: f.id, name: f.name, type: f.type }] : [];
  });

const page = <T>(items: T[], o: ReadOptions) => {
  const offset = Math.max(0, Math.trunc(o.offset ?? 0));
  const limit = Math.min(Math.max(Math.trunc(o.limit ?? 50), 1), MAX_ROWS);
  const shown = items.slice(offset, offset + limit);
  return {
    shown,
    total: items.length,
    nextOffset: offset + shown.length < items.length ? offset + shown.length : null,
  };
};

/** Where the view sits and what it lists, for describe_workspace and describe_view. */
export function viewSummary(bp: Blueprint, view: View) {
  const entity = entityOf(bp, view.entityId);
  const system = pageOf(bp, view.id);
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    ...(entity ? { recordType: entity.id } : {}),
    ...(system ? { pageId: system.id, page: system.name } : {}),
    ...("public" in view && view.public ? { public: true } : {}),
  };
}

/**
 * Every setting of a tab, as stored, with the names of the fields it uses next to their ids. Custom HTML and page
 * text are left out (read_page returns them); everything else is the view itself, so new settings show up here too.
 */
export function describeView(bp: Blueprint, view: View, slug: string) {
  const entity = entityOf(bp, view.entityId);
  const {
    id: _id,
    name: _name,
    type: _type,
    entityId: _entity,
    ...settings
  } = view as View & { html?: string };
  if ("html" in settings) delete (settings as { html?: string }).html;
  if (view.type === "document") delete (settings as { starter?: string }).starter;
  const used = new Set<string>();
  JSON.stringify(settings, (_k, v) => {
    if (typeof v === "string" && entity?.fields.some((f) => f.id === v)) used.add(v);
    return v;
  });
  const hints: Record<string, string> = {
    document: "Markdown text: read it with read_page, change it with write_page.",
    html: "Custom HTML page: read it with read_page, change it with write_page (owners and admins).",
    canvas: "A drawing: read_page lists its shapes.",
    layout: "Parts from the component library in sections; read_view works every part out.",
    form: "A form for adding records; create_record saves the same record it would.",
  };
  return {
    ...viewSummary(bp, view),
    ...(entity ? { recordTypeName: entity.name } : {}),
    ...("public" in view && view.public ? { url: `/s/${slug}/${view.id}` } : {}),
    settings,
    ...(used.size
      ? { fieldNames: Object.fromEntries([...used].map((id) => [id, fieldName(entity, id)])) }
      : {}),
    ...(hints[view.type] ? { hint: hints[view.type] } : {}),
  };
}

/** The date a record is on in a calendar, as YYYY-MM-DD with its start and end. */
function whenOf(value: FieldValue | undefined) {
  if (isTimeRange(value))
    return {
      day: dateKey(new Date(value.start)),
      start: value.start,
      end: value.end,
      time: formatRange(value),
    };
  if (typeof value !== "string" || !value) return null;
  return DAY.test(value) ? { day: value, start: value } : { day: dateKey(new Date(value)), start: value };
}

/** Slots with their Manila time ("6:00 PM – 7:00 PM") next to the instants. */
const labelled = <T extends { start: string; end: string }>(slots: T[] | null) =>
  (slots ?? []).map((s) => ({ ...s, time: formatRange(s) }));

function range(o: ReadOptions, days: number) {
  const today = todayKey(o.now);
  const from = o.from && DAY.test(o.from) ? o.from : today;
  const to = o.to && DAY.test(o.to) && o.to >= from ? o.to : addDays(from, days - 1);
  return { from, to };
}

/** What a tab shows right now, worked out like the app draws it. */
export function readView(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  slug: string,
  view: View,
  o: ReadOptions = {},
): Record<string, unknown> {
  const now = o.now ?? new Date();
  const head = viewSummary(bp, view);
  const entity = entityOf(bp, view.entityId);
  const filtered = (filter?: string) => (entity ? applyFilter(bp, entity, records, filter, now) : []);
  switch (view.type) {
    case "table": {
      if (!entity) return head;
      const rows = sortRecords(filtered(view.filter), view.sort ?? [{ fieldId: "createdAt", dir: "desc" }]);
      const p = page(rows, o);
      const group = entity.fields.find((f) => f.id === view.groupByFieldId);
      const numeric = view.fieldIds.filter((id) => {
        const t = entity.fields.find((f) => f.id === id)?.type;
        return t === "number" || t === "money";
      });
      return {
        ...head,
        columns: columnsOf(entity, view.fieldIds),
        ...(view.filter ? { filter: view.filter } : {}),
        total: p.total,
        nextOffset: p.nextOffset,
        rows: p.shown.map((r) => rowOf(bp, records, entity, r, view.fieldIds)),
        ...(group
          ? {
              groupedBy: group.name,
              groups: countBy(
                rows,
                (r) => formatCell(bp, records, group, r.data[group.id]).text || "(empty)",
              ),
            }
          : {}),
        ...(view.totals && numeric.length
          ? {
              totals: Object.fromEntries(
                numeric.map((id) => {
                  const field = entity.fields.find((f) => f.id === id);
                  const sum = rows.reduce((n, r) => n + (Number(r.data[id]) || 0), 0);
                  return [id, field ? formatCell(bp, records, field, sum).text : String(sum)];
                }),
              ),
            }
          : {}),
      };
    }
    case "kanban": {
      const status = entity?.fields.find((f) => f.id === view.statusFieldId);
      if (!entity || !status) return head;
      const rows = filtered(view.filter);
      const limit = Math.min(Math.max(Math.trunc(o.limit ?? 25), 1), MAX_ROWS);
      return {
        ...head,
        statusField: status.id,
        lanes: (status.options ?? []).map((opt) => {
          const cards = rows.filter((r) => r.data[status.id] === opt.id);
          return {
            option: opt.id,
            label: opt.label,
            count: cards.length,
            cards: cards.slice(0, limit).map((r) => rowOf(bp, records, entity, r, view.cardFieldIds)),
          };
        }),
      };
    }
    case "calendar": {
      if (!entity) return head;
      const { from, to } = range(o, 31);
      const events = filtered(view.filter)
        .flatMap((r) => {
          const when = whenOf(r.data[view.dateFieldId]);
          if (!when || when.day < from || when.day > to) return [];
          const title = r.data[view.titleFieldId];
          return [
            { id: r.id, title: typeof title === "string" && title ? title : recordTitle(entity, r), ...when },
          ];
        })
        .sort((a, b) => a.start.localeCompare(b.start));
      const p = page(events, o);
      return { ...head, from, to, total: p.total, nextOffset: p.nextOffset, events: p.shown };
    }
    case "slot_grid": {
      const booking = entity?.booking;
      if (!entity || !booking) return head;
      const { from: day } = range(o, 1);
      const resourceField = entity.fields.find((f) => f.id === booking.resourceFieldId);
      const resourceType = entityOf(bp, resourceField?.relation?.entityId);
      const resources = resourceType ? records.filter((r) => r.entityId === resourceType.id) : [];
      const form = {
        id: view.id,
        entityId: entity.id,
        name: view.name,
        type: "form",
        fieldIds: [],
      } as FormView;
      return {
        ...head,
        day,
        resources: resources.slice(0, 40).map((res) => ({
          id: res.id,
          name: resourceType ? recordTitle(resourceType, res) : res.id,
          bookings: records
            .filter((r) => r.entityId === entity.id && r.data[booking.resourceFieldId] === res.id)
            .flatMap((r) => {
              const when = whenOf(r.data[booking.timeFieldId]);
              return when && when.day === day
                ? [
                    {
                      ...rowOf(bp, records, entity, r, [booking.statusFieldId]),
                      start: when.start,
                      end: when.end,
                    },
                  ]
                : [];
            }),
          slots: labelled(slotsFor(bp, records, form, res.id, day, now)),
        })),
      };
    }
    case "approval_queue": {
      if (!entity) return head;
      const pending = records.filter(
        (r) => r.entityId === entity.id && r.data[view.statusFieldId] === view.pending,
      );
      const p = page(pending, o);
      return {
        ...head,
        pendingOption: view.pending,
        approveOption: view.approve,
        rejectOption: view.reject,
        statusField: view.statusFieldId,
        total: p.total,
        nextOffset: p.nextOffset,
        pending: p.shown.map((r) => rowOf(bp, records, entity, r, view.detailFieldIds)),
      };
    }
    case "notes": {
      if (!entity) return head;
      const notes = sortRecords(filtered(), [{ fieldId: "createdAt", dir: "desc" }]);
      const p = page(notes, o);
      return {
        ...head,
        total: p.total,
        nextOffset: p.nextOffset,
        notes: p.shown.map((r) => ({
          ...rowOf(bp, records, entity, r, [view.titleFieldId, ...(view.metaFieldIds ?? [])]),
          body: String(r.data[view.bodyFieldId] ?? "").slice(0, 4000),
        })),
      };
    }
    case "checkout": {
      const product = entityOf(bp, view.productEntityId);
      if (!product) return head;
      const p = page(
        records.filter((r) => r.entityId === product.id),
        o,
      );
      return {
        ...head,
        productType: product.id,
        lineType: view.lineEntityId,
        orderType: view.entityId,
        hint: "A sale is an order record (create_record on the order type) plus a line item per product.",
        total: p.total,
        nextOffset: p.nextOffset,
        products: p.shown.map((r) => rowOf(bp, records, product, r)),
      };
    }
    case "form":
      return {
        ...head,
        recordType: view.entityId,
        fields: columnsOf(
          entity as Entity,
          view.fieldIds.length ? view.fieldIds : (entity?.fields ?? []).map((f) => f.id),
        ),
        ...(view.steps?.length
          ? { steps: view.steps.map((s) => ({ title: s.title, fieldIds: s.fieldIds })) }
          : {}),
        hint: "Submit what this form asks with create_record on its record type.",
      };
    case "layout":
      return { ...head, ...resolveLayout(bp, records, docs, slug, view, now, true) };
    case "landing":
      return { ...head, blocks: resolveBlocks(bp, records, docs, slug, view, now) };
    case "document":
    case "html": {
      const body = docs[view.id]?.body ?? (view.type === "html" ? view.html : view.starter) ?? "";
      return { ...head, text: body.slice(0, MAX_TEXT), truncated: body.length > MAX_TEXT };
    }
    case "canvas": {
      const shapes = parseCanvas(docs[view.id]?.body).shapes;
      return {
        ...head,
        shapes: shapes.slice(0, 300).map((s) => ({
          id: s.id,
          type: s.type,
          ...(s.name ? { name: s.name } : {}),
          ...(s.text ? { text: s.text.slice(0, 500) } : {}),
          x: Math.round(s.x),
          y: Math.round(s.y),
          width: Math.round(s.width),
          height: Math.round(s.height),
        })),
      };
    }
    default:
      return head;
  }
}

function countBy(rows: DataRecord[], key: (r: DataRecord) => string) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count }));
}

/** One dashboard card's numbers, as the card shows them. */
export function widgetResult(bp: Blueprint, records: DataRecord[], widget: Widget, now = new Date()) {
  const entity = entityOf(bp, widget.entityId);
  const base = {
    id: widget.id,
    title: widget.title,
    type: widget.type,
    recordType: widget.entityId,
    ...(widget.filter ? { filter: widget.filter } : {}),
  };
  switch (widget.type) {
    case "stat":
    case "progress": {
      const compare = compareStat(bp, widget, records, now);
      // As the card shows it: with a comparison, the current period's value (today, the last 7 or 30 days).
      const value = compare ? compare.current : widgetValue(bp, widget, records, now);
      return {
        ...base,
        value,
        shown: metricFormatter(bp, widget)(value),
        ...(widget.target ? { target: widget.target } : {}),
        ...(compare
          ? { compare: { current: compare.current, previous: compare.previous, against: compare.against } }
          : {}),
      };
    }
    case "chart":
      return { ...base, ...chartData(bp, widget, records, now) };
    case "list": {
      if (!entity || !widget.list)
        return { ...base, value: metricOf(widget, widgetRows(bp, widget, records, now)) };
      const rows = sortRecords(widgetRows(bp, widget, records, now), widget.list.sort);
      return {
        ...base,
        total: rows.length,
        rows: rows
          .slice(0, widget.list.limit)
          .map((r) => rowOf(bp, records, entity, r, widget.list?.fieldIds)),
      };
    }
    case "agenda":
      return {
        ...base,
        days: agendaDays(bp, widget, records, now).map((d) => ({
          day: d.day,
          items: d.items.map((i) => ({
            id: i.record.id,
            title: entity ? recordTitle(entity, i.record) : i.record.id,
            start: i.start,
            ...(i.end ? { end: i.end } : {}),
          })),
        })),
      };
    case "heatmap":
      return { ...base, heatmap: heatmapData(bp, widget, records, now) };
    default:
      return base;
  }
}

/** A page's dashboard: its cards worked out, in order. */
export function readDashboard(bp: Blueprint, records: DataRecord[], system: System, now = new Date()) {
  return {
    pageId: system.id,
    page: system.name,
    tabs: system.viewIds.flatMap((id) => {
      const v = bp.views.find((x) => x.id === id);
      return v ? [viewSummary(bp, v)] : [];
    }),
    cards: system.widgetIds.flatMap((id) => {
      const w = bp.widgets.find((x) => x.id === id);
      return w ? [widgetResult(bp, records, w, now)] : [];
    }),
  };
}

/** Free and taken times (or days) for one resource, the way a booking form offers them. */
export function availability(
  bp: Blueprint,
  records: DataRecord[],
  entity: Entity,
  resourceId: string,
  day: string,
  days = 1,
  now = new Date(),
) {
  const form = { id: "mcp", entityId: entity.id, name: entity.name, type: "form", fieldIds: [] } as FormView;
  const timeField = entity.fields.find((f) => f.id === entity.booking?.timeFieldId);
  if (timeField?.range === "dates") return { days: daysFor(bp, records, form, resourceId, day, days, now) };
  const out: { day: string; date: string; slots: ReturnType<typeof labelled> }[] = [];
  for (let i = 0; i < Math.min(Math.max(days, 1), 14); i++) {
    const d = addDays(day, i);
    out.push({
      day: d,
      date: formatDate(d),
      slots: labelled(slotsFor(bp, records, form, resourceId, d, now)),
    });
  }
  return { days: out };
}
