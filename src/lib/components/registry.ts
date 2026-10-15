import { z } from "zod";
import type { LayoutItem, LayoutSection } from "@/lib/blueprint/types";

/**
 * The component library for layout pages. Every component is built once in code (src/components/layout-page) and
 * described here: its settings as a schema, what it points at (record types, fields, views, dashboard cards) so the
 * validator can check it, and words for the AI. The AI only arranges components and fills in their settings; it
 * never writes components. Add a component here and in the renderer map, and every workspace's assistant can use it.
 */

export type ComponentGroup = "basics" | "data" | "charts" | "blocks" | "workspace";

export const GROUPS: { id: ComponentGroup; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "data", label: "Data" },
  { id: "charts", label: "Charts" },
  { id: "blocks", label: "Blocks" },
  { id: "workspace", label: "From this workspace" },
];

/** What a component's settings point at, so the validator can check each one exists and fits. */
export type Ref =
  | { kind: "entity"; entityId: string }
  | {
      kind: "field";
      entityId: string;
      fieldId: string;
      /** What the field must hold: a date (date, datetime, time range), a number to add up, a picture, or choices. */
      needs?: "date" | "number" | "image" | "group" | "status";
    }
  | { kind: "filter"; entityId: string; expr: string }
  | { kind: "view"; viewId: string }
  | { kind: "widget"; widgetId: string };

type FieldNeed = Extract<Ref, { kind: "field" }>["needs"];

const op = z.enum(["count", "sum", "avg"]).default("count");
const sort = z
  .array(z.object({ fieldId: z.string(), dir: z.enum(["asc", "desc"]).default("asc") }))
  .optional();
const optText = z.string().optional();

/** A total over one record type: counted, or a number field added up or averaged, over the records a filter keeps. */
const metric = {
  entityId: z.string(),
  op,
  fieldId: z.string().optional(),
  filter: z.string().optional(),
};
type Metric = { entityId: string; op: "count" | "sum" | "avg"; fieldId?: string; filter?: string };

const statShape = z.object({
  title: z.string(),
  ...metric,
  /** Compare the current period (today, last 7 or 30 days) with the one before, by this date field. */
  compare: z.object({ dateFieldId: z.string(), period: z.enum(["day", "week", "month"]) }).optional(),
  format: z.enum(["money", "number", "percent"]).optional(),
});

const chartShape = {
  title: z.string(),
  description: optText,
  ...metric,
  /** Over time: one point per day, week or month of this date field. */
  dateFieldId: z.string().optional(),
  bucket: z.enum(["day", "week", "month"]).default("day"),
  /** By category: one bar, slice or spoke per option or linked record of this field. */
  groupByFieldId: z.string().optional(),
  /** One series per option of this field, e.g. income and expense. */
  splitByFieldId: z.string().optional(),
};

const fieldRef = (entityId: string, fieldId: string | undefined, needs?: FieldNeed): Ref[] =>
  fieldId ? [{ kind: "field", entityId, fieldId, needs }] : [];
const filterRef = (entityId: string, expr: string | undefined): Ref[] =>
  expr ? [{ kind: "filter", entityId, expr }] : [];
const metricRefs = (p: Metric): Ref[] => [
  { kind: "entity", entityId: p.entityId },
  ...(p.op !== "count" ? fieldRef(p.entityId, p.fieldId, "number") : []),
  ...filterRef(p.entityId, p.filter),
];

export type ComponentDef = {
  id: string;
  group: ComponentGroup;
  name: string;
  /** For the AI and the gallery: what it's for, in one line. */
  description: string;
  /** Settings, with defaults filled in when parsed. */
  props: z.ZodType<Record<string, unknown>>;
  /** Short settings summary for the AI, e.g. "entityId, fieldIds[], filter?, limit?". */
  settings: string;
  refs: (props: Record<string, unknown>) => Ref[];
  /** Wide components take the section's full width unless a span is given. */
  wide?: boolean;
  /** Holds other components (tabs). */
  container?: boolean;
};

// Each def keeps its own prop types for refs; the registry stores them loosely and the renderer parses again.
function def<S extends z.ZodType<Record<string, unknown>>>(d: {
  id: string;
  group: ComponentGroup;
  name: string;
  description: string;
  props: S;
  settings: string;
  refs?: (props: z.output<S>) => Ref[];
  wide?: boolean;
  container?: boolean;
}): ComponentDef {
  return { ...d, refs: (d.refs ?? (() => [])) as ComponentDef["refs"] };
}

const chartDefs = (
  [
    ["chart_area", "Area chart", "A total over time as a filled area; split for one area per option"],
    ["chart_bar", "Bar chart", "A total over time or by category as bars; split for grouped bars"],
    ["chart_line", "Line chart", "A total over time as a line; split for one line per option"],
  ] as const
).map(([id, name, description]) =>
  def({
    id,
    group: "charts",
    name,
    description,
    props: z.object({ ...chartShape, stacked: z.boolean().default(false) }),
    settings:
      "title, description?, entityId, op, fieldId?, filter?, dateFieldId + bucket (day|week|month) OR groupByFieldId, splitByFieldId?, stacked?",
    refs: (p) => [
      ...metricRefs(p),
      ...fieldRef(p.entityId, p.dateFieldId, "date"),
      ...fieldRef(p.entityId, p.groupByFieldId, "group"),
      ...fieldRef(p.entityId, p.splitByFieldId, "group"),
    ],
  }),
);

export const COMPONENTS: ComponentDef[] = [
  // Basics: shadcn primitives with words the AI writes.
  def({
    id: "heading",
    group: "basics",
    name: "Heading",
    description: "A section title with an optional line under it",
    props: z.object({ title: z.string(), description: optText }),
    settings: "title, description?",
    wide: true,
  }),
  def({
    id: "text",
    group: "basics",
    name: "Text",
    description: "Markdown text: notes, instructions, a short policy",
    props: z.object({ markdown: z.string() }),
    settings: "markdown",
  }),
  def({
    id: "card",
    group: "basics",
    name: "Card",
    description: "A card with a title, a description, a markdown body and a footer line",
    props: z.object({ title: z.string(), description: optText, markdown: optText, footer: optText }),
    settings: "title, description?, markdown?, footer?",
  }),
  def({
    id: "alert",
    group: "basics",
    name: "Alert",
    description: "A callout: a reminder, a warning or good news",
    props: z.object({
      title: z.string(),
      description: optText,
      tone: z.enum(["info", "success", "warning", "danger"]).default("info"),
    }),
    settings: "title, description?, tone (info|success|warning|danger)",
    wide: true,
  }),
  def({
    id: "separator",
    group: "basics",
    name: "Separator",
    description: "A thin line between parts",
    props: z.object({}),
    settings: "none",
    wide: true,
  }),
  def({
    id: "button",
    group: "basics",
    name: "Button",
    description: "A button that opens another page of the workspace",
    props: z.object({
      label: z.string(),
      viewId: z.string(),
      variant: z.enum(["default", "outline", "secondary"]).default("outline"),
    }),
    settings: "label, viewId, variant? (default|outline|secondary)",
    refs: (p) => [{ kind: "view", viewId: p.viewId }],
  }),
  def({
    id: "accordion",
    group: "basics",
    name: "Accordion",
    description:
      "Questions or sections that open one at a time: written items, or records (title and body fields)",
    props: z.object({
      title: optText,
      items: z.array(z.object({ title: z.string(), body: z.string() })).optional(),
      entityId: z.string().optional(),
      titleFieldId: z.string().optional(),
      bodyFieldId: z.string().optional(),
      filter: z.string().optional(),
    }),
    settings: "title?, items[{title, body}] OR entityId + titleFieldId + bodyFieldId + filter?",
    refs: (p) =>
      p.entityId
        ? [
            { kind: "entity", entityId: p.entityId },
            ...fieldRef(p.entityId, p.titleFieldId),
            ...fieldRef(p.entityId, p.bodyFieldId),
            ...filterRef(p.entityId, p.filter),
          ]
        : [],
  }),
  def({
    id: "tabs",
    group: "basics",
    name: "Tabs",
    description: "Tabs that each hold their own components (no tabs inside tabs)",
    props: z.object({
      tabs: z
        .array(
          z.object({
            label: z.string(),
            items: z.array(z.record(z.string(), z.unknown())),
          }),
        )
        .min(1),
    }),
    settings: "tabs[{label, items[{component, span?, props}]}]",
    wide: true,
    container: true,
  }),
  // Data: live records in shadcn tables, items, avatars, badges, a calendar and a carousel.
  def({
    id: "stat",
    group: "data",
    name: "Stat",
    description: "One key number: a count or total, optionally against the previous period",
    props: statShape,
    settings:
      "title, entityId, op (count|sum|avg), fieldId? (sum/avg), filter?, compare? {dateFieldId, period day|week|month}, format? (money|number|percent)",
    refs: (p) => [...metricRefs(p), ...fieldRef(p.entityId, p.compare?.dateFieldId, "date")],
  }),
  def({
    id: "progress",
    group: "data",
    name: "Progress",
    description: "A total against a target, as a bar",
    props: z.object({ title: z.string(), ...metric, target: z.number().positive() }),
    settings: "title, entityId, op, fieldId?, filter?, target",
    refs: metricRefs,
  }),
  def({
    id: "table",
    group: "data",
    name: "Table",
    description: "Records in a compact table; rows open the record",
    props: z.object({
      title: optText,
      entityId: z.string(),
      fieldIds: z.array(z.string()).min(1),
      filter: z.string().optional(),
      sort,
      limit: z.number().int().positive().max(50).default(8),
      viewId: z.string().optional(),
    }),
    settings: "title?, entityId, fieldIds[], filter?, sort?[{fieldId, dir}], limit?, viewId? (View all)",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...p.fieldIds.flatMap((f) => fieldRef(p.entityId, f)),
      ...(p.sort ?? []).flatMap((s) => fieldRef(p.entityId, s.fieldId)),
      ...filterRef(p.entityId, p.filter),
      ...(p.viewId ? [{ kind: "view" as const, viewId: p.viewId }] : []),
    ],
    wide: true,
  }),
  def({
    id: "list",
    group: "data",
    name: "List",
    description:
      "Records as items with their name, a line under it, a badge and a picture; items open the record",
    props: z.object({
      title: optText,
      entityId: z.string(),
      descriptionFieldId: z.string().optional(),
      badgeFieldId: z.string().optional(),
      imageFieldId: z.string().optional(),
      filter: z.string().optional(),
      sort,
      limit: z.number().int().positive().max(30).default(6),
    }),
    settings: "title?, entityId, descriptionFieldId?, badgeFieldId?, imageFieldId?, filter?, sort?, limit?",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...fieldRef(p.entityId, p.descriptionFieldId),
      ...fieldRef(p.entityId, p.badgeFieldId),
      ...fieldRef(p.entityId, p.imageFieldId, "image"),
      ...(p.sort ?? []).flatMap((s) => fieldRef(p.entityId, s.fieldId)),
      ...filterRef(p.entityId, p.filter),
    ],
  }),
  def({
    id: "avatars",
    group: "data",
    name: "Avatars",
    description: "People or things as a row of avatars with a count (staff on duty, today's guests)",
    props: z.object({
      title: optText,
      entityId: z.string(),
      imageFieldId: z.string().optional(),
      filter: z.string().optional(),
      limit: z.number().int().positive().max(12).default(6),
    }),
    settings: "title?, entityId, imageFieldId?, filter?, limit?",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...fieldRef(p.entityId, p.imageFieldId, "image"),
      ...filterRef(p.entityId, p.filter),
    ],
  }),
  def({
    id: "badges",
    group: "data",
    name: "Badge counts",
    description: "How many records have each option of a status, select or linked field, as badges",
    props: z.object({
      title: optText,
      entityId: z.string(),
      fieldId: z.string(),
      filter: z.string().optional(),
    }),
    settings: "title?, entityId, fieldId (status, select or relation), filter?",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...fieldRef(p.entityId, p.fieldId, "group"),
      ...filterRef(p.entityId, p.filter),
    ],
  }),
  def({
    id: "calendar",
    group: "data",
    name: "Mini calendar",
    description: "A month calendar that marks days with records; picking a day lists them",
    props: z.object({
      title: optText,
      entityId: z.string(),
      dateFieldId: z.string(),
      filter: z.string().optional(),
    }),
    settings: "title?, entityId, dateFieldId (date, datetime or time range), filter?",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...fieldRef(p.entityId, p.dateFieldId, "date"),
      ...filterRef(p.entityId, p.filter),
    ],
  }),
  def({
    id: "carousel",
    group: "data",
    name: "Carousel",
    description: "Pictures from records to swipe through (units, products, courts)",
    props: z.object({
      title: optText,
      entityId: z.string(),
      imageFieldId: z.string(),
      filter: z.string().optional(),
      limit: z.number().int().positive().max(20).default(8),
    }),
    settings: "title?, entityId, imageFieldId (picture field), filter?, limit?",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...fieldRef(p.entityId, p.imageFieldId, "image"),
      ...filterRef(p.entityId, p.filter),
    ],
  }),
  // Charts: shadcn charts (Recharts) over live records.
  ...chartDefs,
  def({
    id: "chart_pie",
    group: "charts",
    name: "Pie chart",
    description: "Shares of a total by category, as a pie or donut",
    props: z.object({
      title: z.string(),
      description: optText,
      ...metric,
      groupByFieldId: z.string(),
      donut: z.boolean().default(true),
    }),
    settings: "title, description?, entityId, op, fieldId?, filter?, groupByFieldId, donut?",
    refs: (p) => [...metricRefs(p), ...fieldRef(p.entityId, p.groupByFieldId, "group")],
  }),
  def({
    id: "chart_radar",
    group: "charts",
    name: "Radar chart",
    description: "Compares a total across 3 to 8 categories on spokes",
    props: z.object({ title: z.string(), description: optText, ...metric, groupByFieldId: z.string() }),
    settings: "title, description?, entityId, op, fieldId?, filter?, groupByFieldId",
    refs: (p) => [...metricRefs(p), ...fieldRef(p.entityId, p.groupByFieldId, "group")],
  }),
  def({
    id: "chart_radial",
    group: "charts",
    name: "Radial chart",
    description: "A total against a target as a ring, e.g. this month's sales goal",
    props: z.object({ title: z.string(), description: optText, ...metric, target: z.number().positive() }),
    settings: "title, description?, entityId, op, fieldId?, filter?, target",
    refs: metricRefs,
  }),
  // Blocks: larger premade sections, adapted from shadcn's dashboard blocks.
  def({
    id: "stat_cards",
    group: "blocks",
    name: "Stat cards",
    description: "Two to four key numbers as cards, each with its change against the previous period",
    props: z.object({ stats: z.array(statShape).min(1).max(4) }),
    settings: "stats[ stat settings ] (1 to 4)",
    refs: (p) =>
      p.stats.flatMap((s) => [...metricRefs(s), ...fieldRef(s.entityId, s.compare?.dateFieldId, "date")]),
    wide: true,
  }),
  def({
    id: "chart_interactive",
    group: "blocks",
    name: "Interactive chart",
    description: "A total over time with a 7, 30 or 90 day switch, as an area chart",
    props: z.object({
      title: z.string(),
      description: optText,
      ...metric,
      dateFieldId: z.string(),
      splitByFieldId: z.string().optional(),
    }),
    settings: "title, description?, entityId, op, fieldId?, filter?, dateFieldId, splitByFieldId?",
    refs: (p) => [
      ...metricRefs(p),
      ...fieldRef(p.entityId, p.dateFieldId, "date"),
      ...fieldRef(p.entityId, p.splitByFieldId, "group"),
    ],
    wide: true,
  }),
  def({
    id: "data_table",
    group: "blocks",
    name: "Data table",
    description: "A searchable, sortable table of records with pages; rows open the record",
    props: z.object({
      title: z.string(),
      entityId: z.string(),
      fieldIds: z.array(z.string()).min(1),
      filter: z.string().optional(),
      sort,
      pageSize: z.number().int().min(5).max(50).default(10),
    }),
    settings: "title, entityId, fieldIds[], filter?, sort?, pageSize?",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...p.fieldIds.flatMap((f) => fieldRef(p.entityId, f)),
      ...(p.sort ?? []).flatMap((s) => fieldRef(p.entityId, s.fieldId)),
      ...filterRef(p.entityId, p.filter),
    ],
    wide: true,
  }),
  def({
    id: "leaderboard",
    group: "blocks",
    name: "Leaderboard",
    description:
      "Top categories or linked records ranked by a total, with bars (best sellers, busiest courts)",
    props: z.object({
      title: z.string(),
      ...metric,
      groupByFieldId: z.string(),
      limit: z.number().int().positive().max(15).default(5),
    }),
    settings: "title, entityId, op, fieldId?, filter?, groupByFieldId, limit?",
    refs: (p) => [...metricRefs(p), ...fieldRef(p.entityId, p.groupByFieldId, "group")],
  }),
  def({
    id: "status_overview",
    group: "blocks",
    name: "Status overview",
    description: "How many records are at each stage of a status, each with its share",
    props: z.object({
      title: z.string(),
      entityId: z.string(),
      statusFieldId: z.string(),
      filter: z.string().optional(),
    }),
    settings: "title, entityId, statusFieldId, filter?",
    refs: (p) => [
      { kind: "entity", entityId: p.entityId },
      ...fieldRef(p.entityId, p.statusFieldId, "status"),
      ...filterRef(p.entityId, p.filter),
    ],
  }),
  // The workspace's own screens and dashboard cards, placed inside a layout.
  def({
    id: "form",
    group: "blocks",
    name: "Form",
    description:
      "A public form of this workspace (booking, order, sign-up, inquiry) embedded in the page; on a public layout this is how visitors book",
    props: z.object({ viewId: z.string(), title: optText }),
    settings: "viewId (a public form view), title?",
    refs: (p) => [{ kind: "view", viewId: p.viewId }],
    wide: true,
  }),
  def({
    id: "view",
    group: "workspace",
    name: "Workspace view",
    description:
      "An existing tab of this workspace (table, board, calendar, schedule, register, form, notes) shown in place",
    props: z.object({ viewId: z.string(), height: z.number().int().min(240).max(1200).default(480) }),
    settings: "viewId, height? (pixels)",
    refs: (p) => [{ kind: "view", viewId: p.viewId }],
    wide: true,
  }),
  def({
    id: "widget",
    group: "workspace",
    name: "Dashboard card",
    description:
      "An existing dashboard card of this workspace (stat, chart, list, agenda, heatmap, progress)",
    props: z.object({ widgetId: z.string() }),
    settings: "widgetId",
    refs: (p) => [{ kind: "widget", widgetId: p.widgetId }],
  }),
];

export const COMPONENT_IDS = new Set(COMPONENTS.map((c) => c.id));
export const componentDef = (id: string) => COMPONENTS.find((c) => c.id === id);

/** Names the AI tends to use for components, mapped to the library's ids. */
const ALIASES: Record<string, string> = {
  area_chart: "chart_area",
  bar_chart: "chart_bar",
  line_chart: "chart_line",
  pie_chart: "chart_pie",
  donut_chart: "chart_pie",
  chart_donut: "chart_pie",
  radar_chart: "chart_radar",
  radial_chart: "chart_radial",
  kpi: "stat",
  metric: "stat",
  stats: "stat_cards",
  section_cards: "stat_cards",
  datatable: "data_table",
  records_table: "table",
  embed_view: "view",
  dashboard_card: "widget",
  callout: "alert",
  faq: "accordion",
  markdown: "text",
  divider: "separator",
};
export const resolveComponent = (id: string) => {
  const key = id
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return ALIASES[key] ?? key;
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "part";

type RawItem = Record<string, unknown>;

/**
 * Reads a layout the AI wrote (JSON text or an object): {sections:[{title?, description?, columns, items:[{component,
 * span?, props}]}]} or just the list of sections. Settings written next to component instead of inside props are
 * moved in, component names are matched to the library, ids are filled in, and each component's settings are parsed
 * with its schema (defaults filled). Problems come back as messages for the AI to fix.
 */
export function parseLayout(raw: unknown): { sections: LayoutSection[]; errors: string[] } {
  const errors: string[] = [];
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { sections: [], errors: ['layout: starter isn\'t valid JSON ({"sections": [...]})'] };
    }
  }
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { sections?: unknown }).sections)
      ? (value as { sections: unknown[] }).sections
      : null;
  if (!list) return { sections: [], errors: ['layout: needs {"sections": [...]}'] };
  const used = new Set<string>();
  const uniqueId = (base: string) => {
    let id = slug(base);
    for (let n = 2; used.has(id); n++) id = `${slug(base)}_${n}`;
    used.add(id);
    return id;
  };
  const item = (r: RawItem, at: string, inTabs: boolean): LayoutItem | null => {
    const name = String(r.component ?? r.type ?? "");
    const d = componentDef(resolveComponent(name));
    if (!d) {
      errors.push(`${at}: "${name}" isn't a component (${[...COMPONENT_IDS].join(", ")})`);
      return null;
    }
    if (inTabs && d.container) {
      errors.push(`${at}: tabs can't hold tabs`);
      return null;
    }
    const { id: _id, component: _c, type: _t, span: _s, props: rawProps, ...rest } = r;
    // Settings may arrive as JSON text (setup's layout step asks for them that way to keep its schema small).
    let props = rawProps;
    if (typeof props === "string") {
      try {
        props = JSON.parse(props);
      } catch {
        errors.push(`${at} (${d.id}): props isn't valid JSON`);
        return null;
      }
    }
    const given = { ...rest, ...(props && typeof props === "object" ? (props as RawItem) : {}) };
    const parsed = d.props.safeParse(given);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".") || "settings"} ${i.message}`)
        .join("; ");
      errors.push(`${at} (${d.id}): ${issues}`);
      return null;
    }
    const settings: Record<string, unknown> = { ...parsed.data };
    if (d.container)
      settings.tabs = (settings.tabs as { label: string; items: RawItem[] }[]).map((tab, ti) => ({
        label: tab.label,
        items: tab.items
          .map((x, xi) => item(x, `${at}.tabs[${ti}].items[${xi}]`, true))
          .filter((x): x is LayoutItem => !!x),
      }));
    const span = typeof r.span === "number" && r.span >= 1 ? Math.min(4, Math.round(r.span)) : undefined;
    return {
      id: uniqueId(typeof r.id === "string" && r.id ? r.id : d.id),
      component: d.id,
      ...(span ? { span } : {}),
      props: settings,
    };
  };
  const sections = list.flatMap((s, si): LayoutSection[] => {
    if (!s || typeof s !== "object") {
      errors.push(`sections[${si}]: needs {columns, items}`);
      return [];
    }
    const sec = s as RawItem;
    const items = (Array.isArray(sec.items) ? sec.items : [])
      .map((x, xi) => item((x ?? {}) as RawItem, `sections[${si}].items[${xi}]`, false))
      .filter((x): x is LayoutItem => !!x);
    const columns = typeof sec.columns === "number" ? Math.min(4, Math.max(1, Math.round(sec.columns))) : 1;
    return [
      {
        id: uniqueId(typeof sec.id === "string" && sec.id ? sec.id : `section_${si + 1}`),
        ...(typeof sec.title === "string" && sec.title ? { title: sec.title } : {}),
        ...(typeof sec.description === "string" && sec.description ? { description: sec.description } : {}),
        columns,
        items,
      },
    ];
  });
  if (!sections.some((s) => s.items.length)) errors.push("layout: add at least one component");
  return { sections, errors };
}

/** Every item of a layout, the items inside tabs included, with a readable path. */
export function layoutItems(sections: LayoutSection[]): { item: LayoutItem; path: string }[] {
  return sections.flatMap((s, si) =>
    s.items.flatMap((item, ii) => {
      const path = `sections.${si}.items.${ii}`;
      const inner =
        item.component === "tabs"
          ? ((item.props.tabs as { items: LayoutItem[] }[] | undefined) ?? []).flatMap((t, ti) =>
              t.items.map((x, xi) => ({ item: x, path: `${path}.tabs.${ti}.items.${xi}` })),
            )
          : [];
      return [{ item, path }, ...inner];
    }),
  );
}

/** The library as the AI reads it: one line per component with its settings. */
export function catalogText(): string {
  return GROUPS.map(
    (g) =>
      `${g.label}:\n${COMPONENTS.filter((c) => c.group === g.id)
        .map((c) => `  - ${c.id}: ${c.description}. Settings: ${c.settings}`)
        .join("\n")}`,
  ).join("\n");
}
