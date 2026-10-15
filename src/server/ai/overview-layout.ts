import "server-only";
import type { Blueprint, LayoutItem, LayoutSection, LayoutView, System, Widget } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { layoutItems, parseLayout } from "@/lib/components/registry";
import { todayKey } from "@/lib/time";
import { generateJsonHedged } from "./gemini";
import {
  OVERVIEW_SYSTEM,
  type OverviewRequest,
  overviewContext,
  overviewRequest,
} from "./overview-layout-prompt";

export const OVERVIEW_VIEW_ID = "overview_layout";

/** The page the Overview lives on: the one that only holds dashboard cards (or is named Overview or Dashboard). */
function overviewHome(bp: Blueprint): System | undefined {
  return (
    bp.systems.find((s) => !s.viewIds.length && /overview|dashboard|home/i.test(`${s.id} ${s.name}`)) ??
    bp.systems.find((s) => !s.viewIds.length && s.widgetIds.length)
  );
}

/**
 * Puts a layout page on the workspace's Overview, or a new Overview page at the top. The layout is the Overview: the
 * page's cards the layout doesn't place leave the page (no second dashboard beside it) but stay in the workspace, so
 * Edit layout offers them as parts to add back.
 */
export function placeOverview(bp: Blueprint, view: LayoutView): Blueprint {
  const next = structuredClone(bp);
  const home = overviewHome(next);
  next.views.push(view);
  if (home) {
    const placed = new Set(
      layoutItems(view.sections).flatMap(({ item }) =>
        item.component === "widget" ? [String(item.props.widgetId)] : [],
      ),
    );
    home.viewIds = [view.id, ...home.viewIds];
    home.widgetIds = home.widgetIds.filter((id) => placed.has(id));
  } else
    next.systems.unshift({
      id: next.systems.some((s) => s.id === "overview") ? "overview_page" : "overview",
      name: "Overview",
      icon: "gauge",
      viewIds: [view.id],
      widgetIds: [],
    });
  return next;
}

/**
 * The parts of a layout the workspace can show: each part is checked on its own and dropped when it points at
 * something that doesn't exist or doesn't fit; sections left empty go too.
 */
export function keepValidParts(bp: Blueprint, view: LayoutView): LayoutView {
  const placed = placeOverview(bp, view);
  const bad = new Set(
    validateBlueprint(placed).flatMap((e) => {
      const at = placed.views.findIndex((v) => v.id === view.id);
      const prefix = `views.${at}.`;
      return e.path.startsWith(prefix) ? [e.path.slice(prefix.length)] : [];
    }),
  );
  const badItems = new Set(
    layoutItems(view.sections)
      .filter(({ path }) => [...bad].some((b) => b === path || b.startsWith(`${path}.`)))
      .map(({ item }) => item),
  );
  return {
    ...view,
    sections: view.sections
      .map((s) => ({ ...s, items: s.items.filter((i) => !badItems.has(i)) }))
      .filter((s) => s.items.length),
  };
}

const MIN_PARTS = 3;

/**
 * The Overview without the AI: the template cards (see templateOverview) as layout parts, in the dashboard's order.
 * Today's numbers fill the first row; then each row pairs a wide card (chart, heatmap) over two of three columns with
 * a narrow one (schedule, list). Used when the layout step fails, so every workspace opens on a full Overview.
 */
export function templateLayout(bp: Blueprint): LayoutView | undefined {
  const home = overviewHome(bp);
  const cards = (home?.widgetIds ?? [])
    .map((id) => bp.widgets.find((w) => w.id === id))
    .filter((w): w is Widget => !!w);
  if (!cards.length) return undefined;
  const part = (w: Widget, span?: number): LayoutItem => ({
    id: w.id,
    component: "widget",
    props: { widgetId: w.id },
    ...(span ? { span } : {}),
  });
  const stats = cards.filter((w) => w.type === "stat").slice(0, 4);
  const rest = cards.filter((w) => !stats.includes(w));
  const sections: LayoutSection[] = [];
  if (stats.length)
    sections.push({ id: "today", title: "Today", columns: stats.length, items: stats.map((w) => part(w)) });
  const wide = (w: Widget) => w.type === "chart" || w.type === "heatmap";
  for (let i = 0; i < rest.length; i += 2) {
    const row = rest.slice(i, i + 2);
    sections.push({
      id: `row_${i / 2 + 1}`,
      columns: row.length === 1 ? 1 : 3,
      items: row.length === 1 ? [part(row[0])] : row.map((w) => part(w, wide(w) ? 2 : 1)),
    });
  }
  return { id: OVERVIEW_VIEW_ID, name: "Overview", entityId: "", type: "layout", sections };
}

/** The template layout on the Overview, or the workspace as it was when it has no cards to lay out. */
export function withTemplateLayout(bp: Blueprint): Blueprint {
  const view = templateLayout(bp);
  if (!view) return bp;
  const kept = keepValidParts(bp, view);
  return layoutItems(kept.sections).length ? placeOverview(bp, kept) : bp;
}

/**
 * Setup's Overview layout. One Gemini call with a small schema; parts that don't check out are dropped, and when too
 * little is left (or Gemini fails) the Overview is the template layout instead. It never fails setup.
 */
export async function withOverviewLayout(
  bp: Blueprint,
  name: string,
  brief: string,
  now = new Date(),
): Promise<Blueprint> {
  if (bp.views.some((v) => v.type === "layout")) return bp;
  const started = Date.now();
  const result = await generateJsonHedged(
    overviewRequest,
    {
      system: OVERVIEW_SYSTEM,
      prompt: overviewContext(bp, name, brief, todayKey(now)),
      task: "overview-layout",
      timeoutMs: 60_000,
      idleMs: 20_000,
      firstPartMs: 40_000,
      thinking: "LOW",
      maxOutputTokens: 6000,
      enumLiterals: true,
    },
    { hedgeMs: 30_000, attempts: 2, afterSilence: true },
  ).catch((e) => ({ ok: false as const, error: String(e) }));
  if (!result.ok) {
    console.warn(JSON.stringify({ event: "overview_layout_skipped", reason: result.error }));
    return withTemplateLayout(bp);
  }
  const raw = result.data as OverviewRequest;
  const parsed = parseLayout({
    sections: raw.sections.map((s) => ({
      ...s,
      items: s.items.map((i) => ({ ...i, ...(i.span > 0 ? {} : { span: undefined }) })),
    })),
  });
  const view = keepValidParts(bp, {
    id: OVERVIEW_VIEW_ID,
    name: "Overview",
    entityId: "",
    type: "layout",
    sections: parsed.sections,
  });
  const parts = layoutItems(view.sections).length;
  console.info(
    JSON.stringify({
      event: "overview_layout",
      ms: Date.now() - started,
      parts,
      dropped: layoutItems(parsed.sections).length - parts,
      parseErrors: parsed.errors.slice(0, 5),
    }),
  );
  return parts >= MIN_PARTS ? placeOverview(bp, view) : withTemplateLayout(bp);
}
