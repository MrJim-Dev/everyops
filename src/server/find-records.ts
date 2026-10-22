import "server-only";
import type { DataRecord } from "@/lib/blueprint/types";
import { visibleTo } from "@/lib/engine/access";
import type { StoredRecord } from "@/lib/store/workspace-sync";
import { dateKey } from "@/lib/time";
import { viewerIn } from "./access";
import { db } from "./db";
import { currentBlueprint, readRecords } from "./workspace-data";
import { enterZone } from "./zone";

export const MAX_FIND = 1000;

/** The day a date, date-time or time range falls on, on the workspace's clock. */
function dayOf(value: unknown): string | null {
  const start =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { start?: unknown }).start
      : value;
  return typeof start === "string" && !Number.isNaN(Date.parse(start)) ? dateKey(start) : null;
}

/**
 * Records of one type found on the server, for views of a windowed type (src/lib/engine/window.ts) that need some of
 * its older records: a calendar month or a schedule day (dateField within from–to), a board lane or a record's
 * line items (field equals a value). Newest first by dateField when there is one. Only records the person may see.
 */
export async function findRecords(
  workspaceId: string,
  userId: string,
  q: {
    entityId: string;
    field?: string;
    equals?: string;
    dateField?: string;
    from?: string;
    to?: string;
    before?: string;
    offset: number;
    limit: number;
  },
): Promise<{ total: number; rows: StoredRecord[] } | null> {
  const viewer = await viewerIn(db, workspaceId, userId);
  if (!viewer) return null;
  const bp = await currentBlueprint(db, workspaceId);
  enterZone(bp);
  const entity = bp?.entities.find((e) => e.id === q.entityId);
  if (!bp || !entity) return null;
  const known = (id?: string) => !id || entity.fields.some((f) => f.id === id);
  if (!known(q.field) || !known(q.dateField)) return null;
  const day = (r: DataRecord) => (q.dateField ? dayOf(r.data[q.dateField]) : null);
  const found = visibleTo(bp, viewer, await readRecords(db, workspaceId)).filter((s) => {
    const r = s.record;
    if (r.entityId !== entity.id) return false;
    if (q.field && String(r.data[q.field] ?? "") !== (q.equals ?? "")) return false;
    const d = day(r);
    if (q.from && (!d || d < q.from)) return false;
    if (q.to && (!d || d > q.to)) return false;
    if (q.before && (!d || d >= q.before)) return false;
    return true;
  });
  if (q.dateField) found.sort((a, b) => (day(b.record) ?? "").localeCompare(day(a.record) ?? ""));
  return { total: found.length, rows: found.slice(q.offset, q.offset + Math.min(q.limit, MAX_FIND)) };
}
