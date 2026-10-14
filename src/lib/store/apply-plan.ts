import { applyOps, type ChangePlan, commitChange, revertChange } from "@/lib/engine/changes";
import { computeAll } from "@/lib/engine/compute";
import { applyRecordOps } from "@/lib/engine/records";
import { blueprintOf, type ChangeEntry, randomToken, type Workspace } from "./workspace-model";

/**
 * Applies an approved plan to a workspace and returns the history entry that can undo it: the blueprint
 * version it came from, values formulas changed, records it added, edited or deleted, page text it replaced
 * and the team as it was.
 */
export function applyPlan(
  ws: Workspace,
  plan: ChangePlan,
  options: { by?: string; now?: Date } = {},
): { workspace: Workspace; entry: ChangeEntry } {
  const now = options.now ?? new Date();
  const redesign = plan.ops.length > 0;
  const current = blueprintOf(ws);
  const next = redesign ? { ...applyOps(current, plan.ops), version: ws.versions.length + 1 } : current;
  // Records of a record type the plan removes leave with it; the entry keeps them for undo.
  const known = new Set(next.entities.map((e) => e.id));
  const orphaned = redesign ? ws.records.filter((r) => !known.has(r.entityId)) : [];
  const kept = orphaned.length ? ws.records.filter((r) => known.has(r.entityId)) : ws.records;
  const { data, changes } = redesign
    ? commitChange({ blueprint: current, records: kept }, next, now)
    : { data: { blueprint: current, records: kept }, changes: [] };
  const edits = plan.recordOps?.length ? applyRecordOps(data, plan.recordOps, now) : null;

  const docs = { ...(ws.docs ?? {}) };
  const replacedDocs: Record<string, { body: string; updatedAt: string } | null> = {};
  for (const d of plan.docOps ?? []) {
    if (!(d.viewId in replacedDocs)) replacedDocs[d.viewId] = ws.docs?.[d.viewId] ?? null;
    docs[d.viewId] = { body: d.body, updatedAt: now.toISOString() };
  }

  let members = ws.members ?? [];
  let invites = ws.invites ?? [];
  for (const t of plan.teamOps ?? []) {
    const email = t.email.trim().toLowerCase();
    if (t.op === "invite" && !members.some((m) => m.email.toLowerCase() === email))
      invites = [
        ...invites.filter((i) => i.email !== email),
        {
          token: randomToken(),
          email,
          role: t.role,
          invitedAt: now.toISOString(),
          invitedBy: options.by ?? "",
        },
      ];
    if (t.op === "set_role") {
      members = members.map((m) => (m.email.toLowerCase() === email ? { ...m, role: t.role } : m));
      invites = invites.map((i) => (i.email === email ? { ...i, role: t.role } : i));
    }
    if (t.op === "revoke_invite") invites = invites.filter((i) => i.email !== email);
  }

  const removed = [...orphaned, ...(edits?.removed ?? [])];
  const entry: ChangeEntry = {
    id: `change_${now.getTime().toString(36)}${randomToken(2)}`,
    request: plan.request,
    title: plan.title,
    steps: plan.steps,
    fromVersion: ws.currentVersion,
    toVersion: next.version,
    recordChanges: changes,
    appliedAt: now.toISOString(),
    ...(edits ? { createdRecordIds: edits.created, replacedRecords: edits.replaced } : {}),
    ...(removed.length ? { removedRecords: removed } : {}),
    ...(Object.keys(replacedDocs).length ? { replacedDocs } : {}),
    ...(plan.teamOps?.length ? { teamBefore: { members: ws.members ?? [], invites: ws.invites ?? [] } } : {}),
  };
  return {
    entry,
    workspace: {
      ...ws,
      name: next.workspaceName,
      versions: redesign ? [...ws.versions, next] : ws.versions,
      currentVersion: next.version,
      records: (edits?.data ?? data).records,
      ...(plan.docOps?.length ? { docs } : {}),
      ...(plan.teamOps?.length ? { members, invites } : {}),
      changes: [entry, ...ws.changes],
    },
  };
}

/**
 * Undoes one change, newest first: anything applied after it must be undone before it. Returns null when it
 * can't be undone (already undone, or newer changes came after it).
 */
export function undoPlan(ws: Workspace, changeId: string, now = new Date()): Workspace | null {
  const at = ws.changes.findIndex((c) => c.id === changeId);
  const entry = ws.changes[at];
  if (!entry || entry.undoneAt || ws.currentVersion !== entry.toVersion) return null;
  // History is newest first: every newer change has to be undone before this one.
  if (ws.changes.slice(0, at).some((c) => !c.undoneAt)) return null;
  // Data edits first: drop the records it added, put back the ones it changed or deleted.
  const created = new Set(entry.createdRecordIds ?? []);
  const before = new Map((entry.replacedRecords ?? []).map((r) => [r.id, r]));
  const present = new Set(ws.records.map((r) => r.id));
  const records = [
    ...ws.records.filter((r) => !created.has(r.id)).map((r) => before.get(r.id) ?? r),
    ...(entry.removedRecords ?? []).filter((r) => !present.has(r.id)),
  ];
  const previous = ws.versions[entry.fromVersion - 1];
  const restored =
    entry.fromVersion !== entry.toVersion
      ? revertChange({ blueprint: blueprintOf(ws), records }, previous, entry.recordChanges, now)
      : { blueprint: previous, records: computeAll(previous, records, now) };
  const docs = { ...(ws.docs ?? {}) };
  for (const [viewId, doc] of Object.entries(entry.replacedDocs ?? {})) {
    if (doc) docs[viewId] = doc;
    else delete docs[viewId];
  }
  const team = entry.teamBefore;
  return {
    ...ws,
    name: previous.workspaceName,
    currentVersion: entry.fromVersion,
    records: restored.records,
    ...(entry.replacedDocs ? { docs } : {}),
    ...(team
      ? {
          // Roles go back; nobody who joined since is removed, and invites return to how they were.
          members: (ws.members ?? []).map((m) => {
            const old = team.members.find((x) => x.accountId === m.accountId);
            return old ? { ...m, role: old.role } : m;
          }),
          invites: team.invites,
        }
      : {}),
    changes: ws.changes.map((c) => (c.id === changeId ? { ...c, undoneAt: now.toISOString() } : c)),
  };
}
