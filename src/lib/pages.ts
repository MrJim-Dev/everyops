import type { Blueprint, HtmlPageView, LandingView, System, View } from "@/lib/blueprint/types";
import { isPublic } from "@/lib/public/resolve";

/**
 * Pages: what people make to show or share something, a report, a price list, a booking or home page. In the
 * blueprint they are html views (a page EveryOps designed, with live data) and landing views (the standard site).
 * People never see those type names: in the app, in Ask EveryOps and in the docs they are all "pages".
 */
export type PageView = HtmlPageView | LandingView;

export const isPageView = (view: View | undefined): view is PageView =>
  view?.type === "html" || view?.type === "landing";

/** A sidebar entry made only of pages: listed under Pages, apart from the systems the team works in. */
export function isPagesSystem(bp: Blueprint, system: System): boolean {
  const views = system.viewIds.map((id) => bp.views.find((v) => v.id === id));
  return !system.widgetIds.length && views.length > 0 && views.every(isPageView);
}

/** Who can open a page: only the workspace's team, or anyone with its link. */
export type PageAudience = "team" | "anyone";

export type PageEntry = {
  view: PageView;
  /** The sidebar entry the page is on, which is where it opens. */
  system: System;
  /** What it's called: the sidebar's name when the page is all there is on that entry, else the tab's. */
  title: string;
  audience: PageAudience;
  /** When its words or design last changed; pages that were never edited have none. */
  updatedAt?: string;
  /** One line about what's on it, from its first paragraph. */
  summary: string;
};

type Docs = Record<string, { body: string; updatedAt?: string } | undefined>;

/** A page's name as people see it: the sidebar entry's name when the page is its only tab. */
export const pageTitle = (view: View, system: System | undefined) =>
  system?.viewIds.length === 1 ? system.name : view.name;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();

/**
 * A short description of a page from its HTML: the first paragraph long enough to say something, else the start of
 * its text. Scripts, styles, templates (rows filled in from live data) and comments are left out.
 */
export function pageSummary(html: string, max = 140): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|head|nav|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => text(m[1]));
  const found = paragraphs.find((p) => p.length >= 24) ?? text(body);
  return found.length > max ? `${found.slice(0, max - 1).trimEnd()}…` : found;
}

function summaryOf(view: PageView, docs: Docs): string {
  if (view.type === "html") return pageSummary(docs[view.id]?.body ?? view.html ?? "");
  const hero = view.blocks.find((b) => b.type === "hero");
  if (hero?.type === "hero") return hero.subheading || hero.heading;
  const words = view.blocks.find((b) => b.type === "text");
  return words?.type === "text" ? text(words.markdown).slice(0, 140) : "";
}

/** Every page in the workspace, in sidebar order, with what the Pages library shows about it. */
export function pagesOf(bp: Blueprint, docs: Docs): PageEntry[] {
  const out: PageEntry[] = [];
  for (const system of bp.systems)
    for (const id of system.viewIds) {
      const view = bp.views.find((v) => v.id === id);
      if (!isPageView(view)) continue;
      const updatedAt =
        view.type === "html"
          ? docs[view.id]?.updatedAt
          : view.blocks
              .map((b) => docs[`${view.id}:${b.id}`]?.updatedAt)
              .filter((t): t is string => !!t)
              .sort()
              .at(-1);
      out.push({
        view,
        system,
        title: pageTitle(view, system),
        audience: isPublic(view) ? "anyone" : "team",
        ...(updatedAt ? { updatedAt } : {}),
        summary: summaryOf(view, docs),
      });
    }
  return out;
}
