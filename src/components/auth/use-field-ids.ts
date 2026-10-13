import { useId } from "react";

/**
 * Unique ids per form instance. Next keeps recently visited pages mounted (hidden),
 * so fixed ids like "email" would collide across the auth pages and break labels.
 */
export function useFieldIds<T extends string>(...names: T[]): Record<T, string> {
  const base = useId();
  return Object.fromEntries(names.map((name) => [name, `${base}-${name}`])) as Record<T, string>;
}
