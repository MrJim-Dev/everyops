import type { Blueprint } from "@/lib/blueprint/types";
import { CATEGORIES, type CatalogCategory } from "@/lib/catalog";
import type { PublishInput } from "@/lib/community/published";

export const LICENSES = { MIT: "MIT", "Apache-2.0": "Apache 2.0" } as const;
export const CATEGORY_ITEMS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/** Guess a category from what the blueprint contains. */
export function guessCategory(blueprint: Blueprint): CatalogCategory {
  const views = blueprint.views.map((v) => v.type as string);
  if (views.includes("checkout")) return "pos";
  if (views.includes("slot_grid")) return "booking";
  if (views.includes("approval_queue")) return "hris";
  if (views.includes("kanban")) return "social";
  return "finance";
}

export type PublishErrors = { name?: string; summary?: string };

export function validatePublish(input: PublishInput): PublishErrors {
  const errors: PublishErrors = {};
  if (input.name.trim().length < 3) errors.name = "Use at least 3 characters";
  if (input.summary.trim().length < 20) errors.summary = "Describe what it does in at least 20 characters";
  return errors;
}

export function nextVersion(version: string) {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${(minor || 0) + 1}`;
}
