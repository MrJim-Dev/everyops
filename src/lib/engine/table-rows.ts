import { displayKind } from "@/lib/blueprint/field-kind";
import { getField, recordTitle } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, Field, Sort, TableView } from "@/lib/blueprint/types";
import { applyFilter, searchRecords, sortRecords } from "./query";
import { valueText } from "./value-text";

/**
 * A table's rows as it shows them: its filter, then the search over the title and its columns, then the sort, then
 * grouped by a field (groups in the field's option order, others by name, empty last). The table works this out in
 * the browser; for record types that page on the server (src/lib/engine/window.ts) the server does it, the same way.
 */
export type TableGroup = { key: string; label: string; rows: DataRecord[] };

export function tableRows(
  bp: Blueprint,
  entity: Entity,
  view: Pick<TableView, "fieldIds" | "filter">,
  records: DataRecord[],
  opts: { query: string; sort: Sort[] | undefined; groupField?: Field },
): { rows: DataRecord[]; groups: TableGroup[] | null } {
  const fields = view.fieldIds.map((id) => getField(entity, id));
  const filtered = applyFilter(bp, entity, records, view.filter);
  const searched = searchRecords(filtered, opts.query, (r) =>
    [recordTitle(entity, r), ...fields.map((f) => JSON.stringify(r.data[f.id] ?? ""))].join(" "),
  );
  const rows = sortRecords(searched, opts.sort);
  const groupField = opts.groupField;
  if (!groupField) return { rows, groups: null };
  const map = new Map<string, TableGroup>();
  for (const o of groupField.options ?? []) map.set(o.id, { key: o.id, label: o.label, rows: [] });
  for (const row of rows) {
    const raw = row.data[groupField.id];
    const key = raw === undefined || raw === null || raw === "" ? "" : String(raw);
    let group = map.get(key);
    if (!group) {
      const label = key
        ? valueText(bp, records, groupField, raw) || key
        : `No ${groupField.name.toLowerCase()}`;
      group = { key, label, rows: [] };
      map.set(key, group);
    }
    group.rows.push(row);
  }
  const groups = [...map.values()].filter((g) => g.rows.length);
  if (!groupField.options) groups.sort((a, b) => (a.key ? (b.key ? a.label.localeCompare(b.label) : -1) : 1));
  return { rows, groups };
}

/** Columns with a total: amounts and counts add up, time adds up as time, and ratings show their average. */
export const summable = (bp: Blueprint, f: Field) =>
  ["money", "number", "duration", "rating"].includes(displayKind(bp, f));

/** A column's total over some rows (a rating's is its average over the rated ones). */
export function columnTotal(bp: Blueprint, f: Field, list: DataRecord[]): number {
  if (displayKind(bp, f) !== "rating") return list.reduce((sum, r) => sum + (Number(r.data[f.id]) || 0), 0);
  const rated = list.map((r) => Number(r.data[f.id])).filter((n) => n > 0);
  return rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 0;
}
