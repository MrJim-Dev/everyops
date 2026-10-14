import { recordTitle } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, LandingView, LayoutItem, LayoutView, Sort } from "@/lib/blueprint/types";
import {
  type ChartData,
  chartOf,
  countsOf,
  dailyOf,
  daysOf,
  goalOf,
  type Metric,
  rankedOf,
  type StatProps,
  stagesOf,
  statOf,
} from "@/lib/components/compute";
import { publicProblems } from "@/lib/components/public-safety";
import { componentDef } from "@/lib/components/registry";
import { applyFilter, sortRecords } from "@/lib/engine/query";
import { isImagePath } from "@/lib/engine/records";
import { type Cell, formatCell, type PageDocs, type PublicItem, resolveBlocks, sitePath } from "./resolve";

/**
 * A public layout page as a visitor receives it: every part already worked out on the server. Numbers and charts
 * arrive as results, lists as the fields they name (formatted text, rows numbered instead of record ids). Parts that
 * would show people or the team's own screens are left out even if the page was saved with them.
 */
export type PublicLayoutItem = {
  id: string;
  component: string;
  span?: number;
  data: Record<string, unknown>;
};
export type PublicLayout = {
  sections: {
    id: string;
    title?: string;
    description?: string;
    columns: number;
    items: PublicLayoutItem[];
  }[];
};

const MAX_ROWS = 500;

/** Chart points keyed by position: a category's own key can be a linked record's id, which a visitor never needs. */
const anonymous = (chart: ChartData): ChartData => ({
  ...chart,
  points: chart.points.map((p, i) => ({ ...p, bucket: `p${i + 1}` })),
});

export function resolveLayout(
  bp: Blueprint,
  records: DataRecord[],
  docs: PageDocs,
  slug: string,
  view: LayoutView,
  now = new Date(),
): PublicLayout {
  const entityOf = (id: string) => bp.entities.find((e) => e.id === id);
  const rowsOf = (entityId: string, filter?: string, sort?: Sort[]) => {
    const entity = entityOf(entityId);
    return entity ? sortRecords(applyFilter(bp, entity, records, filter, now), sort) : [];
  };
  const cells = (entityId: string, row: DataRecord, fieldIds: string[]): Cell[] => {
    const entity = entityOf(entityId);
    return fieldIds.flatMap((id) => {
      const field = entity?.fields.find((f) => f.id === id);
      return field ? [formatCell(bp, records, field, row.data[id])] : [];
    });
  };
  const numbered = (entityId: string, rows: DataRecord[], fieldIds: string[]): PublicItem[] =>
    rows.slice(0, MAX_ROWS).map((r, i) => ({ id: `row_${i + 1}`, cells: cells(entityId, r, fieldIds) }));

  const part = (item: LayoutItem): PublicLayoutItem | null => {
    const d = componentDef(item.component);
    if (!d) return null;
    const parsed = d.props.safeParse(item.props);
    if (!parsed.success || publicProblems(bp, d, parsed.data).length) return null;
    // biome-ignore lint/suspicious/noExplicitAny: each component's settings were just parsed by its own schema
    const p = parsed.data as any;
    const out = (data: Record<string, unknown>): PublicLayoutItem => ({
      id: item.id,
      component: item.component,
      ...(item.span ? { span: item.span } : {}),
      data,
    });
    switch (item.component) {
      case "heading":
      case "text":
      case "card":
      case "alert":
      case "separator":
        return out(p);
      case "button": {
        return out({ label: p.label, variant: p.variant, href: sitePath(slug, p.viewId) });
      }
      case "accordion": {
        if (!p.entityId) return out({ title: p.title, items: p.items ?? [] });
        const entity = entityOf(p.entityId);
        if (!entity) return null;
        const items = rowsOf(p.entityId, p.filter)
          .slice(0, 50)
          .map((r) => ({
            title: p.titleFieldId ? String(r.data[p.titleFieldId] ?? "") : recordTitle(entity, r),
            body: p.bodyFieldId ? String(r.data[p.bodyFieldId] ?? "") : "",
          }));
        return out({ title: p.title, items });
      }
      case "tabs":
        return out({
          tabs: (p.tabs as { label: string; items: LayoutItem[] }[]).map((t) => ({
            label: t.label,
            items: t.items.map(part).filter((x): x is PublicLayoutItem => !!x),
          })),
        });
      case "stat":
        return out({ stat: statOf(bp, records, p as StatProps, now) });
      case "stat_cards":
        return out({ stats: (p.stats as StatProps[]).map((s) => statOf(bp, records, s, now)) });
      case "progress":
      case "chart_radial":
        return out({ goal: goalOf(bp, records, p, now) });
      case "chart_area":
      case "chart_bar":
      case "chart_line":
        return out({
          head: { title: p.title, description: p.description },
          chart: anonymous(
            chartOf(
              bp,
              records,
              p,
              item.component === "chart_area" ? "area" : item.component === "chart_bar" ? "bar" : "line",
              now,
            ),
          ),
          stacked: p.stacked,
        });
      case "chart_pie":
        return out({
          head: { title: p.title, description: p.description },
          chart: anonymous(chartOf(bp, records, p, "donut", now)),
          donut: p.donut,
        });
      case "chart_radar":
        return out({
          head: { title: p.title, description: p.description },
          chart: anonymous(chartOf(bp, records, p, "bar", now)),
        });
      case "chart_interactive":
        return out({ title: p.title, description: p.description, chart: dailyOf(bp, records, p, now) });
      case "leaderboard":
        return out({ title: p.title, ...rankedOf(bp, records, p, now) });
      case "status_overview":
        return out({ title: p.title, ...stagesOf(bp, records, p, now) });
      case "badges": {
        const entity = entityOf(p.entityId);
        const field = entity?.fields.find((f) => f.id === p.fieldId);
        return out({
          title: p.title ?? (entity && field ? `${entity.pluralName} by ${field.name.toLowerCase()}` : ""),
          items: countsOf(bp, records, p, now),
        });
      }
      case "table":
      case "data_table": {
        const entity = entityOf(p.entityId);
        if (!entity) return null;
        const rows = rowsOf(p.entityId, p.filter, p.sort);
        const limited = item.component === "table" ? rows.slice(0, p.limit) : rows;
        return out({
          title: p.title ?? entity.pluralName,
          total: rows.length,
          columns: (p.fieldIds as string[]).flatMap((id) => {
            const f = entity.fields.find((x) => x.id === id);
            return f ? [{ id: f.id, name: f.name }] : [];
          }),
          items: numbered(p.entityId, limited, p.fieldIds),
          ...(item.component === "data_table" ? { pageSize: p.pageSize, searchable: true } : {}),
        });
      }
      case "list": {
        const entity = entityOf(p.entityId);
        if (!entity) return null;
        const rows = rowsOf(p.entityId, p.filter, p.sort);
        return out({
          title: p.title ?? entity.pluralName,
          total: rows.length,
          items: rows.slice(0, p.limit).map((r, i) => {
            const [description] = p.descriptionFieldId ? cells(p.entityId, r, [p.descriptionFieldId]) : [];
            const [badge] = p.badgeFieldId ? cells(p.entityId, r, [p.badgeFieldId]) : [];
            const image = p.imageFieldId ? r.data[p.imageFieldId] : undefined;
            return {
              id: `row_${i + 1}`,
              title: recordTitle(entity, r),
              ...(description ? { description: description.text } : {}),
              ...(badge ? { badge } : {}),
              ...(isImagePath(image) ? { image } : {}),
            };
          }),
        });
      }
      case "carousel": {
        const entity = entityOf(p.entityId);
        if (!entity) return null;
        return out({
          title: p.title ?? entity.pluralName,
          items: rowsOf(p.entityId, p.filter)
            .filter((r) => isImagePath(r.data[p.imageFieldId]))
            .slice(0, p.limit)
            .map((r, i) => ({
              id: `row_${i + 1}`,
              title: recordTitle(entity, r),
              image: String(r.data[p.imageFieldId]),
            })),
        });
      }
      case "calendar": {
        const entity = entityOf(p.entityId);
        if (!entity) return null;
        const byDay = daysOf(bp, records, p as Metric & { dateFieldId: string }, now);
        return out({
          title: p.title ?? entity.pluralName,
          plural: { one: entity.name.toLowerCase(), many: entity.pluralName.toLowerCase() },
          counts: Object.fromEntries([...byDay].map(([k, v]) => [k, v.length])),
        });
      }
      case "form": {
        const page: LandingView = {
          id: view.id,
          entityId: "",
          name: view.name,
          type: "landing",
          blocks: [{ id: item.id, type: "form", viewId: p.viewId, ...(p.title ? { title: p.title } : {}) }],
        };
        const [block] = resolveBlocks(bp, records, docs, slug, page, now);
        return block ? out({ block }) : null;
      }
      default:
        return null;
    }
  };

  return {
    sections: view.sections
      .map((s) => ({
        id: s.id,
        ...(s.title ? { title: s.title } : {}),
        ...(s.description ? { description: s.description } : {}),
        columns: s.columns,
        items: s.items.map(part).filter((x): x is PublicLayoutItem => !!x),
      }))
      .filter((s) => s.items.length),
  };
}
