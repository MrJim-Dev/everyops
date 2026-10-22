import "server-only";
import { type RawBuilder, sql } from "kysely";
import type { Blueprint } from "@/lib/blueprint/types";
import { ADDED_BY, isLimited, type Viewer, visibleTo } from "@/lib/engine/access";
import type { ChangeEntry } from "@/lib/store/workspace-model";
import type { readRecords } from "./workspace-data";

type Ex = Parameters<typeof readRecords>[0];

/**
 * The person reading or writing, for record-level access (src/lib/engine/access.ts): their role in the workspace
 * and the name and email that person and email fields hold for them.
 */
export async function viewerOf(ex: Ex, userId: string, role: Viewer["role"]): Promise<Viewer> {
  const { rows } = await sql<{ name: string | null; email: string | null }>`
    select name, email from "user" where id = ${userId}`.execute(ex);
  return { userId, role, name: rows[0]?.name ?? "", email: rows[0]?.email ?? "" };
}

/** The person as a viewer of one workspace (their role there), or null when they aren't in it. */
export async function viewerIn(ex: Ex, workspaceId: string, userId: string): Promise<Viewer | null> {
  const { rows } = await sql<{ role: Viewer["role"] | null; name: string | null; email: string | null }>`
    select case when w.owner_id = u.id then 'owner' else m.role end as role, u.name, u.email
    from workspace w join "user" u on u.id = ${userId}
    left join workspace_member m on m.workspace_id = w.id and m.user_id = u.id
    where w.id = ${workspaceId}`.execute(ex);
  const row = rows[0];
  return row?.role ? { userId, role: row.role, name: row.name ?? "", email: row.email ?? "" } : null;
}

/**
 * The same limit as canSee, as a condition on workspace_record rows, for lookups that run as SQL (the assistant's
 * and MCP's record tools). True for everyone who sees every record.
 */
export function accessScope(bp: Blueprint, viewer: Viewer | undefined): RawBuilder<unknown> {
  if (!viewer || !isLimited(bp, viewer)) return sql`true`;
  const mine = [viewer.name, viewer.email].map((s) => s.trim().toLowerCase()).filter(Boolean);
  const parts = bp.entities.flatMap((e) => {
    const by = e.access?.by;
    if (!by) return [];
    const own =
      by === ADDED_BY
        ? sql`created_by->>'id' = ${viewer.userId}`
        : sql`(lower(trim(data->>${by})) = any(${mine}::text[]) or exists (select 1 from jsonb_array_elements_text(
            case when jsonb_typeof(data->${by}) = 'array' then data->${by} else '[]'::jsonb end) v
            where lower(trim(v)) = any(${mine}::text[])))`;
    return [sql`(entity_id <> ${e.id} or ${own})`];
  });
  return parts.length ? sql`(${sql.join(parts, sql` and `)})` : sql`true`;
}

/**
 * A workspace's records and history as a limited member may see them: only their records, and history without the
 * copies of records it keeps for undo.
 */
export function limitWorkspace<
  T extends { records: { id: string; entityId: string }[] | unknown[]; changes: ChangeEntry[] },
>(
  bp: Blueprint,
  viewer: Viewer,
  doc: T,
  revs: Record<string, number>,
): { doc: T; revs: Record<string, number> } {
  if (!isLimited(bp, viewer)) return { doc, revs };
  const records = visibleTo(bp, viewer, doc.records as Parameters<typeof visibleTo>[2]);
  const seen = new Set(records.map((r) => ("record" in r ? r.record.id : r.id)));
  return {
    doc: {
      ...doc,
      records,
      changes: doc.changes.map(({ replacedRecords: _r, removedRecords: _m, ...c }) => ({
        ...c,
        recordChanges: [],
      })),
    },
    revs: Object.fromEntries(Object.entries(revs).filter(([id]) => seen.has(id))),
  };
}
