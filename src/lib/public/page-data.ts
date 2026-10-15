import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { applyFilter, sortRecords } from "@/lib/engine/query";
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
      cells: fields.map((f) => formatCell(bp, records, f, r.data[f.id])),
    })),
  };
}
