import type { Blueprint, DataRecord, Field, FieldValue } from "@/lib/blueprint/types";
import { sharedFields, sharedTableProblems } from "@/lib/components/public-safety";
import { applyFilter, sortRecords } from "@/lib/engine/query";
import { boundSources, itemsOf } from "./bindings";
import { formatCell, type PublicPageData } from "./resolve";

/** Project only already-published results. Never return source HTML, blueprint or raw records. */
export function publishedPageData(page: PublicPageData) {
  if (page.type === "layout")
    return { ok: true as const, viewId: page.id, name: page.name, type: page.type, layout: page.layout };
  if (page.type === "landing")
    return {
      ok: true as const,
      viewId: page.id,
      name: page.name,
      type: page.type,
      blocks: page.blocks.filter((block) => block.type !== "html"),
    };
  return { ok: false as const, message: "Choose a published layout or landing page as the data source." };
}

/**
 * What a public page's bindings will list (the titles of its rows), for visitors and crawlers without JavaScript.
 * Only sources a visitor may already read: the page's own sections and tables shared as public data.
 */
export function listedText(bp: Blueprint, records: DataRecord[], page: PublicPageData): string[] {
  const out: string[] = [];
  for (const id of boundSources(page.html ?? "")) {
    const data =
      id === "page"
        ? { ok: true, type: "landing", blocks: page.live ?? [] }
        : publicTableData(bp, records, id);
    const list =
      id === "page"
        ? (page.live ?? []).flatMap((b) => (b.type === "records" ? [itemsOf(data, b.id)] : []))
        : [itemsOf(data)];
    for (const l of list) if (l.ok) out.push(...l.items.map((i) => i.fields["@title"]).filter(Boolean));
  }
  return [...new Set(out)].slice(0, 60);
}

/**
 * What a team-only page counts and adds up with, beside the words it shows: numbers and money as numbers, dates and
 * times as ISO text, a time range as {start, end}, a choice as its option id, a checkbox as true or false, a link as
 * the record id. Pictures, signatures and long text have none (their text is what there is to show).
 */
function cellValue(field: Field, value: FieldValue | undefined): FieldValue | undefined {
  if (value === undefined || value === "" || ["image", "signature", "long_text", "file"].includes(field.type))
    return undefined;
  return value;
}

/** Called only by the authenticated workspace wrapper for a PRIVATE HTML page. */
export function workspaceTableData(bp: Blueprint, records: DataRecord[], viewId: string) {
  const view = bp.views.find((v) => v.id === viewId);
  const entity = view && bp.entities.find((e) => e.id === view.entityId);
  if (!view || view.type !== "table" || !entity)
    return { ok: false as const, message: "Choose a workspace table view as the data source." };
  const fields = view.fieldIds.flatMap((id) => entity.fields.filter((f) => f.id === id));
  const rows = sortRecords(applyFilter(bp, entity, records, view.filter, new Date()), view.sort);
  return {
    ok: true as const,
    viewId,
    name: view.name,
    type: "table" as const,
    total: rows.length,
    truncated: rows.length > 500,
    columns: fields.map((f) => ({ id: f.id, name: f.name })),
    items: rows.slice(0, 500).map((r) => ({
      id: r.id,
      cells: fields.map((f) => {
        const value = cellValue(f, r.data[f.id]);
        return { ...formatCell(bp, records, f, r.data[f.id]), ...(value === undefined ? {} : { value }) };
      }),
    })),
  };
}

/**
 * A table view the owner shared as public data (TableView.publicData), for public HTML pages: its filter and sort,
 * only the fields visitors may see, at most 500 rows. Record ids are included so a page can link to a detail page.
 */
export function publicTableData(bp: Blueprint, records: DataRecord[], viewId: string) {
  const view = bp.views.find((v) => v.id === viewId);
  const entity = view && bp.entities.find((e) => e.id === view.entityId);
  if (!view || view.type !== "table" || !view.publicData || !entity || sharedTableProblems(bp, view).length)
    return { ok: false as const, message: "This data source isn't shared." };
  const fields = sharedFields(bp, view);
  const rows = sortRecords(applyFilter(bp, entity, records, view.filter, new Date()), view.sort);
  return {
    ok: true as const,
    viewId,
    name: view.name,
    type: "table" as const,
    total: rows.length,
    truncated: rows.length > 500,
    columns: fields.map((f) => ({ id: f.id, name: f.name })),
    items: rows.slice(0, 500).map((r) => ({
      id: r.id,
      cells: fields.map((f) => formatCell(bp, records, f, r.data[f.id])),
    })),
  };
}
