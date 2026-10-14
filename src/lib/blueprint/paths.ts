import type { Blueprint, Entity, Field } from "./types";

/** How many links a formula may follow: line.order.branch.region is three. */
export const MAX_LINKS = 3;

export type PathStep = { entity: Entity; field: Field };

/**
 * Walks a formula reference ("qty", "product.price", "delivery.supplier.lead_days") through the blueprint: each
 * part before the last must be a link to another record type. time.start and time.end read a time range's ends.
 * Returns every field it passes, so callers can tell what a formula depends on.
 */
export function walkPath(
  bp: Blueprint,
  entity: Entity,
  path: string[],
): { steps: PathStep[]; error?: string } {
  const steps: PathStep[] = [];
  const ref = path.join(".");
  if (path.length - 1 > MAX_LINKS) return { steps, error: `"${ref}" follows more than ${MAX_LINKS} links` };
  let current = entity;
  for (let i = 0; i < path.length; i++) {
    const field = current.fields.find((f) => f.id === path[i]);
    if (!field)
      return {
        steps,
        error:
          i === 0
            ? `"${path[0]}" is not a field on ${current.name}`
            : `"${ref}" does not resolve: ${current.name} has no field "${path[i]}"`,
      };
    steps.push({ entity: current, field });
    if (i === path.length - 1) break;
    const end = path[i + 1];
    if (field.type === "time_range" && i === path.length - 2 && (end === "start" || end === "end")) break;
    const next = field.relation ? bp.entities.find((e) => e.id === field.relation?.entityId) : undefined;
    if (field.type !== "relation" || !next)
      return { steps, error: `"${ref}" does not resolve through ${field.name}, which isn't a link` };
    current = next;
  }
  return { steps };
}
