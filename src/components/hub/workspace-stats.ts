import { blueprintOf, recordCount, type Workspace } from "@/lib/store/workspace-model";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The numbers a workspace card and the summary strip show. All derived from real workspace data. */
export function workspaceStats(ws: Workspace, now: number) {
  // List summaries carry counts and the latest change; a loaded workspace has its records and history.
  const recordsThisWeek =
    ws.loaded === false
      ? (ws.stats?.recordsThisWeek ?? 0)
      : ws.records.filter((r) => now - Date.parse(r.createdAt) < WEEK).length;
  const lastChange = ws.changes.find((c) => !c.undoneAt);
  const team = [
    ...(ws.owner ? [{ id: ws.ownerId ?? "owner", name: ws.owner.name }] : []),
    ...(ws.members ?? []).map((m) => ({ id: m.accountId, name: m.name })),
  ];
  return {
    systems: blueprintOf(ws)?.systems ?? [],
    records: recordCount(ws),
    recordsThisWeek,
    team,
    invited: ws.invites?.length ?? 0,
    lastChange,
  };
}
