/**
 * How much a community system is really used. Counted from the workspaces built from it (their source), leaving
 * out the starter workspaces every new account gets, which say nothing about anyone choosing it:
 * - uses: workspaces people built from it, with Use or by asking Ask EveryOps to start from it;
 * - active: of those, the ones whose records someone changed in the last 30 days (after the day it was made, so
 *   the sample records a copy starts with don't count);
 * - recent: the ones made in the last 30 days.
 * The same numbers sort Community, mark its cards and tell setup's AI which systems are proven.
 */
export type TemplateUsage = { uses: number; active: number; recent: number };

/** A system's usage, with the numbers it doesn't have yet (the curated catalog, an older API answer) as zero. */
export const usageOf = (s: { uses: number; active?: number; recent?: number }): TemplateUsage => ({
  uses: s.uses,
  active: s.active ?? 0,
  recent: s.recent ?? 0,
});

export type UsageBadge = "popular" | "trending" | "new";

/** Most used: the systems with the most workspaces in use this month (at least two), at most two of them. */
const POPULAR_MIN_ACTIVE = 2;
const POPULAR_COUNT = 2;
/** New: published in the last two weeks and not used yet. */
const NEW_DAYS = 14;

type Rated = TemplateUsage & { id: string; publishedAt?: string };

/** Busiest first: workspaces in use this month, then all workspaces built from it, then the newest ones. */
export function byUsage(a: TemplateUsage, b: TemplateUsage): number {
  return b.active - a.active || b.uses - a.uses || b.recent - a.recent;
}

/** The mark each system gets on its card, if any: Most used, Trending (most of its uses are new) or New. */
export function usageBadges(systems: Rated[], now = new Date()): Map<string, UsageBadge> {
  const badges = new Map<string, UsageBadge>();
  const popular = systems
    .filter((s) => s.active >= POPULAR_MIN_ACTIVE)
    .sort(byUsage)
    .slice(0, POPULAR_COUNT);
  for (const s of popular) badges.set(s.id, "popular");
  for (const s of systems) {
    if (badges.has(s.id)) continue;
    if (s.recent >= 2 && s.recent * 2 >= s.uses) badges.set(s.id, "trending");
    else if (
      !s.uses &&
      s.publishedAt &&
      now.getTime() - new Date(s.publishedAt).getTime() < NEW_DAYS * 86_400_000
    )
      badges.set(s.id, "new");
  }
  return badges;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line for people and for the AI: "Used by 12 workspaces, 8 active in the last 30 days, 3 new this month". */
export function usageText({ uses, active, recent }: TemplateUsage): string {
  if (!uses) return "Not used yet";
  const parts = [`Used by ${plural(uses, "workspace", "workspaces")}`];
  parts.push(active ? `${active} active in the last 30 days` : "none active in the last 30 days");
  if (recent) parts.push(`${recent} new this month`);
  return parts.join(", ");
}
