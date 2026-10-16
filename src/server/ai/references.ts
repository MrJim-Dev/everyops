import "server-only";
import type { Blueprint } from "@/lib/blueprint/types";
import { BUILD_PRINCIPLES, COMMON_NEEDS, matchPlaybooks, type Playbook } from "@/lib/catalog/playbooks";
import { type CommunitySystem, getCommunity, listCommunity } from "@/server/community";

/** Community systems change rarely; setup reads them once every few minutes. */
let cache: { at: number; systems: CommunitySystem[] } | undefined;
async function community(): Promise<CommunitySystem[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.systems;
  const systems = await listCommunity().catch(() => cache?.systems ?? []);
  cache = { at: Date.now(), systems };
  return systems;
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );

/** How a community system is built, in a few lines: its record types, screens and public pages. */
export function describeSystem(s: Pick<CommunitySystem, "id" | "name" | "summary" | "blueprint">): string {
  const bp: Blueprint = s.blueprint;
  const types = bp.entities
    .map((e) => `${e.name}${e.parent ? " (line items)" : ""}: ${e.fields.map((f) => f.name).join(", ")}`)
    .join("; ");
  const screens = bp.systems
    .map(
      (sys) =>
        `${sys.name} [${sys.viewIds
          .map((id) => bp.views.find((v) => v.id === id)?.type)
          .filter(Boolean)
          .join(
            ", ",
          )}${sys.widgetIds.length ? `${sys.viewIds.length ? ", " : ""}${sys.widgetIds.length} dashboard cards` : ""}]`,
    )
    .join("; ");
  const rules = bp.rules.map((r) => r.name).join("; ");
  return `- ${s.name} (${s.id}): ${s.summary}\n  Record types: ${types}\n  Pages: ${screens}${rules ? `\n  Rules: ${rules}` : ""}`;
}

export type SetupReferences = { playbooks: Playbook[]; systems: CommunitySystem[] };

/**
 * How setup builds a workspace, decided from the description before any Gemini call:
 * - template: the owner runs one kind of business whose community system is its main shape (court bookings for a
 *   pickleball venue). Setup clones that system and asks Gemini for the changes, a patch of a few thousand tokens,
 *   instead of a design of ten thousand or more.
 * - playbook: playbooks match but no one system fits (a salon with payroll). The designer writes the workspace
 *   with the matched systems' blueprints as its examples.
 * - custom: nothing matches. The designer writes it with the standard examples.
 */
export type SetupTier = "template" | "playbook" | "custom";
export type SetupRoute = { tier: SetupTier; base?: CommunitySystem };

/**
 * The route for a description. Template only when exactly one business playbook matched, no system playbook
 * (payroll, CRM) asks for more than it covers, and that playbook names a base the community has; or when the
 * description names a community system itself ("start from court-bookings"), which the interview writes into
 * the brief after choosing one.
 */
export function setupRoute(text: string, refs: Pick<SetupReferences, "playbooks" | "systems">): SetupRoute {
  const named = refs.systems.find((s) => new RegExp(`(^|[^a-z0-9-])${s.id}([^a-z0-9-]|$)`, "i").test(text));
  if (named) return { tier: "template", base: named };
  if (!refs.playbooks.length) return { tier: "custom" };
  const businesses = refs.playbooks.filter((p) => p.kind === "business");
  const extras = refs.playbooks.filter((p) => p.kind === "system");
  const base = businesses.length === 1 && !extras.length ? businesses[0].base : undefined;
  const system = base ? refs.systems.find((s) => s.id === base) : undefined;
  return system ? { tier: "template", base: system } : { tier: "playbook" };
}

/**
 * What setup builds on for a description: the playbooks of businesses like it, and the community systems that fit
 * best (the ones those playbooks recommend first, then by shared words). Empty lists when nothing fits.
 */
export async function setupReferences(text: string, limit = 3): Promise<SetupReferences> {
  const playbooks = matchPlaybooks(text);
  const recommended = new Set(playbooks.flatMap((p) => [...p.references, ...(p.base ? [p.base] : [])]));
  const wanted = words(text);
  const scored = (await community()).map((s) => {
    const about = words(
      [s.name, s.summary, ...s.includes, ...s.blueprint.entities.map((e) => e.pluralName)].join(" "),
    );
    let score = recommended.has(s.id) ? 5 : 0;
    for (const w of about) if (wanted.has(w)) score++;
    // A system the owner names in the brief ("based on court-bookings") is what they want.
    if (text.includes(s.id)) score += 10;
    return { s, score };
  });
  const systems = scored
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
  return { playbooks, systems };
}

/** A community system by id, for a base the interview chose: from the cached list, else read on its own. */
export async function communitySystem(id: string): Promise<CommunitySystem | undefined> {
  const cached = (await community()).find((s) => s.id === id);
  if (cached) return cached;
  return (await getCommunity(id).catch(() => null)) ?? undefined;
}

/** The references as prompt text: what businesses like this need, and how similar community systems are built. */
export function referencesText(refs: SetupReferences): string {
  const parts = [
    `How to build so the owner can run and grow it without a redesign:\n${BUILD_PRINCIPLES}`,
    `What every business that serves customers usually needs:\n${COMMON_NEEDS}`,
  ];
  for (const p of refs.playbooks)
    parts.push(
      p.kind === "business"
        ? `What ${p.name.toLowerCase()} usually need:\n${p.needs}\nWorth asking: ${p.ask}`
        : `What a system for ${p.name.toLowerCase()} usually has (build the parts this business needs):\n${p.needs}\nWorth asking: ${p.ask}`,
    );
  if (refs.systems.length)
    parts.push(
      `Community systems built for similar businesses (start from them, then add what's missing):\n${refs.systems.map(describeSystem).join("\n")}`,
    );
  return parts.join("\n\n");
}

/**
 * The interview's instructions when setup will start from a community system: propose it, ask only what changes
 * it, and keep the brief to the facts and the differences, since the designer has the system itself.
 */
export function startingPointText(
  base: Pick<CommunitySystem, "id" | "name" | "summary" | "blueprint">,
): string {
  return `Starting point: EveryOps will build this workspace from the community system "${base.name}" (id ${base.id}) and
adapt it, instead of designing from scratch. It already has:
${describeSystem(base)}
So: say in your plan that you'll start from it and name what you'll change or add; ask only what changes it (the
real resources, items or services and their prices, hours, counts, payment methods, and what this business does
that it lacks); never ask about what it already covers. When designing, write a short brief, under 1,500
characters: the first line exactly "Start from: ${base.id}", then the business facts (name, what is booked, rented or
sold with real prices, hours and counts, how customers pay), then what to add that the system lacks, what to remove,
and what to rename. Don't list its record types, fields, pages or sample records: the designer has them.`;
}
