import type { Workspace } from "@/lib/store/workspace-model";
import { blueprintOf } from "@/lib/store/workspace-model";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The numbers a workspace card and the summary strip show. All derived from real workspace data. */
export function workspaceStats(ws: Workspace, now: number) {
  const recordsThisWeek = ws.records.filter((r) => now - Date.parse(r.createdAt) < WEEK).length;
  const lastChange = [...ws.changes].reverse().find((c) => !c.undoneAt);
  const team = [
    ...(ws.owner ? [{ id: ws.ownerId ?? "owner", name: ws.owner.name }] : []),
    ...(ws.members ?? []).map((m) => ({ id: m.accountId, name: m.name })),
  ];
  return {
    systems: blueprintOf(ws)?.systems ?? [],
    records: ws.records.length,
    recordsThisWeek,
    team,
    invited: ws.invites?.length ?? 0,
    lastChange,
  };
}
