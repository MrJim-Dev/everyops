import type { LayoutItem, LayoutSection } from "@/lib/blueprint/types";
import { componentDef } from "./registry";

/**
 * Edits to a layout page's sections, as the owner makes them in Edit layout. Each returns new sections and leaves
 * the input alone, so the editor keeps a draft and saves it as one change (undoable from History).
 */

type Where = { section: number; item: number };

const clone = (sections: LayoutSection[]) => structuredClone(sections);
const fresh = (sections: LayoutSection[], base: string) => {
  const used = new Set(sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]));
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
};

/** A part moves one place earlier or later; at a section's edge it moves into the section before or after. */
export function moveItem(sections: LayoutSection[], at: Where, by: -1 | 1): LayoutSection[] {
  const next = clone(sections);
  const from = next[at.section];
  const [item] = from.items.splice(at.item, 1);
  if (!item) return sections;
  const target = at.item + by;
  if (target >= 0 && target <= from.items.length) from.items.splice(target, 0, item);
  else {
    const other = next[at.section + by];
    if (!other) return sections;
    if (by < 0) other.items.push(item);
    else other.items.unshift(item);
  }
  return next;
}

/** A part spans one column more or less, within its section's columns. */
export function resizeItem(sections: LayoutSection[], at: Where, by: -1 | 1): LayoutSection[] {
  const next = clone(sections);
  const section = next[at.section];
  const item = section?.items[at.item];
  if (!item) return sections;
  const current = item.span ?? (componentDef(item.component)?.wide ? section.columns : 1);
  item.span = Math.min(section.columns, Math.max(1, current + by));
  return next;
}

export function removeItem(sections: LayoutSection[], at: Where): LayoutSection[] {
  const next = clone(sections);
  next[at.section]?.items.splice(at.item, 1);
  return next;
}

export function addItem(
  sections: LayoutSection[],
  section: number,
  item: Omit<LayoutItem, "id">,
): LayoutSection[] {
  const next = clone(sections);
  const target = next[section];
  if (!target) return sections;
  target.items.push({ ...item, id: fresh(next, item.component) } as LayoutItem);
  return next;
}

export function moveSection(sections: LayoutSection[], index: number, by: -1 | 1): LayoutSection[] {
  const to = index + by;
  if (to < 0 || to >= sections.length) return sections;
  const next = clone(sections);
  const [s] = next.splice(index, 1);
  next.splice(to, 0, s);
  return next;
}

export function removeSection(sections: LayoutSection[], index: number): LayoutSection[] {
  return clone(sections).filter((_, i) => i !== index);
}

export function addSection(sections: LayoutSection[], title = "New section"): LayoutSection[] {
  const next = clone(sections);
  next.push({ id: fresh(next, "section"), title, columns: 2, items: [] });
  return next;
}

/** A section's columns (1 to 4); spans wider than the new count shrink to fit. */
export function setColumns(sections: LayoutSection[], index: number, columns: number): LayoutSection[] {
  const next = clone(sections);
  const s = next[index];
  if (!s) return sections;
  s.columns = Math.min(4, Math.max(1, Math.round(columns)));
  for (const item of s.items) if (item.span && item.span > s.columns) item.span = s.columns;
  return next;
}

export function renameSection(sections: LayoutSection[], index: number, title: string): LayoutSection[] {
  const next = clone(sections);
  if (!next[index]) return sections;
  const clean = title.trim();
  if (clean) next[index].title = clean;
  else delete next[index].title;
  return next;
}

/** Plain words for what an edit session changed, for History. */
export function describeEdits(before: LayoutSection[], after: LayoutSection[]): string {
  const ids = (ss: LayoutSection[]) => new Set(ss.flatMap((s) => s.items.map((i) => i.id)));
  const was = ids(before);
  const now = ids(after);
  const added = [...now].filter((id) => !was.has(id)).length;
  const removed = [...was].filter((id) => !now.has(id)).length;
  const parts = [
    added ? `added ${added} ${added === 1 ? "part" : "parts"}` : "",
    removed ? `removed ${removed} ${removed === 1 ? "part" : "parts"}` : "",
    "rearranged the page",
  ].filter(Boolean);
  return parts.join(", ").replace(/^./, (c) => c.toUpperCase());
}
