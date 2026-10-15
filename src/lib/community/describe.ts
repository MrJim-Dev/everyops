import type { Blueprint } from "@/lib/blueprint/types";

/** What a blueprint contains, in words, for listings. */
/** What a system contains, for listings (the first few) or the publish page (limit: everything). */
export function describeBlueprint(bp: Blueprint, limit = 5): string[] {
  const names: Partial<Record<string, string>> = {
    slot_grid: "Schedule",
    checkout: "Register",
    approval_queue: "Approval queue",
    kanban: "Board",
    calendar: "Calendar",
    form: "Form",
    notes: "Notebook",
    document: "Pages",
    canvas: "Canvas",
    html: "Custom pages",
    layout: "Layout pages",
  };
  const screens = [...new Set(bp.views.map((v) => names[v.type]).filter((n): n is string => !!n))];
  return [
    ...bp.entities.map((e) => `${e.name} records`),
    ...screens,
    ...(bp.rules.length ? [`${bp.rules.length} automatic ${bp.rules.length === 1 ? "rule" : "rules"}`] : []),
  ].slice(0, limit);
}
