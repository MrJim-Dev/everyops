import "server-only";
import type { Blueprint, LayoutView } from "@/lib/blueprint/types";
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

/**
 * Puts a layout page on the workspace's Overview: the page that only holds dashboard cards (or one named Overview or
 * Dashboard), or a new Overview page at the top. Its cards stay; the ones the layout doesn't place keep their own
 * Dashboard tab beside it.
 */
export function placeOverview(bp: Blueprint, view: LayoutView): Blueprint {
  const next = structuredClone(bp);
  const home =
    next.systems.find((s) => !s.viewIds.length && /overview|dashboard|home/i.test(`${s.id} ${s.name}`)) ??
    next.systems.find((s) => !s.viewIds.length && s.widgetIds.length);
  next.views.push(view);
  if (home) home.viewIds = [view.id, ...home.viewIds];
  else
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
 * Setup's Overview layout. One Gemini call with a small schema; parts that don't check out are dropped, and when too
 * little is left (or Gemini fails) the workspace keeps its plain dashboard. It never fails setup.
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
    return bp;
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
  return parts >= MIN_PARTS ? placeOverview(bp, view) : bp;
}
