import "server-only";
import { getField } from "@/lib/blueprint/lookup";
import type { Sort } from "@/lib/blueprint/types";
import { visibleTo } from "@/lib/engine/access";
import { columnTotal, summable, tableRows } from "@/lib/engine/table-rows";
import type { StoredRecord } from "@/lib/store/workspace-sync";
import { viewerIn } from "./access";
import { db } from "./db";
import { currentBlueprint, readRecords } from "./workspace-data";
import { enterZone } from "./zone";

export const MAX_ROWS_PAGE = 500;

export type ViewRows = {
  /** Matching rows in all. */
  total: number;
  /** The page, with each record's rev, for the browser's copy. */
  rows: StoredRecord[];
  /** Column totals over every matching row, by field id. */
  totals: Record<string, number>;
  /** Groups in order, with their size and totals over every row in them. */
  groups: { key: string; label: string; count: number; totals: Record<string, number> }[] | null;
};

/**
 * One page of a table, worked out on the server over every record the person may see (src/lib/engine/access.ts),
 * the way the table works it out in the browser (src/lib/engine/table-rows.ts). Tables of large record types use
 * it, since the browser has only a recent window of those (src/lib/engine/window.ts).
 */
export async function viewRows(
  workspaceId: string,
  userId: string,
  viewId: string,
  opts: { offset: number; limit: number; query: string; sort?: Sort[]; groupBy?: string },
): Promise<ViewRows | null> {
  const viewer = await viewerIn(db, workspaceId, userId);
  if (!viewer) return null;
  const bp = await currentBlueprint(db, workspaceId);
  enterZone(bp);
  const view = bp?.views.find((v) => v.id === viewId);
  const entity = bp?.entities.find((e) => e.id === view?.entityId);
  if (!bp || !view || view.type !== "table" || !entity) return null;
  const stored = visibleTo(bp, viewer, await readRecords(db, workspaceId));
  const revs = new Map(stored.map((s) => [s.record.id, s.rev]));
  const groupField = entity.fields.find((f) => f.id === opts.groupBy);
  const { rows, groups } = tableRows(
    bp,
    entity,
    view,
    stored.map((s) => s.record),
    { query: opts.query, sort: opts.sort ?? view.sort, groupField },
  );
  const fields = view.fieldIds.map((id) => getField(entity, id)).filter((f) => summable(bp, f));
  const totalsOf = (list: typeof rows) =>
    Object.fromEntries(fields.map((f) => [f.id, columnTotal(bp, f, list)]));
  const ordered = groups ? groups.flatMap((g) => g.rows) : rows;
  const page = ordered.slice(opts.offset, opts.offset + Math.min(opts.limit, MAX_ROWS_PAGE));
  return {
    total: ordered.length,
    rows: page.map((record) => ({ record, rev: revs.get(record.id) ?? 1 })),
    totals: totalsOf(rows),
    groups:
      groups?.map((g) => ({ key: g.key, label: g.label, count: g.rows.length, totals: totalsOf(g.rows) })) ??
      null,
  };
}
