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
  options: { by?: string; now?: Date; auto?: boolean } = {},
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
    ...(options.by ? { appliedBy: options.by } : {}),
    ...(options.auto ? { auto: true } : {}),
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
 * Redoes the most recently undone design change by moving back to the version it made, the way it was first
 * applied. Only design changes can be redone: their versions are kept, while record, page and team edits aren't.
 */
export function canRedo(ws: Workspace, changeId: string): boolean {
  const at = ws.changes.findIndex((c) => c.id === changeId);
  const entry = ws.changes[at];
  return (
    !!entry?.undoneAt &&
    entry.fromVersion !== entry.toVersion &&
    ws.currentVersion === entry.fromVersion &&
    !!ws.versions[entry.toVersion - 1] &&
    !entry.createdRecordIds?.length &&
    !entry.replacedRecords?.length &&
    !entry.replacedDocs &&
    !entry.teamBefore &&
    // Everything newer is undone too, so the workspace is back on the version this change started from.
    ws.changes.slice(0, at).every((c) => c.undoneAt)
  );
}

export function redoPlan(ws: Workspace, changeId: string, now = new Date()): Workspace | null {
  if (!canRedo(ws, changeId)) return null;
  const entry = ws.changes.find((c) => c.id === changeId);
  if (!entry) return null;
  const current = blueprintOf(ws);
  const next = ws.versions[entry.toVersion - 1];
  const known = new Set(next.entities.map((e) => e.id));
  const orphaned = ws.records.filter((r) => !known.has(r.entityId));
  const kept = orphaned.length ? ws.records.filter((r) => known.has(r.entityId)) : ws.records;
  const { data, changes } = commitChange({ blueprint: current, records: kept }, next, now);
  return {
    ...ws,
    name: next.workspaceName,
    currentVersion: entry.toVersion,
    records: data.records,
    changes: ws.changes.map((c) => {
      if (c.id !== changeId) return c;
      const { undoneAt: _undone, removedRecords: _removed, ...rest } = c;
      return { ...rest, recordChanges: changes, ...(orphaned.length ? { removedRecords: orphaned } : {}) };
    }),
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

export type RevertResult =
  | { ok: true; workspace: Workspace; undone: ChangeEntry[] }
  /** Changes still in effect that came after the oldest one asked for, and aren't part of the request. */
  | { ok: false; blocking: ChangeEntry[] }
  | { ok: false; blocking?: undefined };

/**
 * Undoes a set of changes in one go, newest first (a conversation's changes from one message on). Every change
 * still in effect since the oldest of them must be in the set: a newer change made elsewhere would be lost or
 * broken by the undo, so it is returned as blocking instead. Nothing changes unless every undo succeeds.
 */
export function revertChanges(ws: Workspace, ids: string[], now = new Date()): RevertResult {
  const wanted = new Set(ids);
  // History is newest first, so the span to undo runs from the top down to the oldest change asked for.
  const live = ws.changes.flatMap((c, i) => (c.undoneAt ? [] : [{ c, i }]));
  const oldest = Math.max(-1, ...live.filter((x) => wanted.has(x.c.id)).map((x) => x.i));
  if (oldest < 0) return { ok: true, workspace: ws, undone: [] };
  const span = live.filter((x) => x.i <= oldest).map((x) => x.c);
  const blocking = span.filter((c) => !wanted.has(c.id));
  if (blocking.length) return { ok: false, blocking };
  let next = ws;
  for (const c of span) {
    const undone = undoPlan(next, c.id, now);
    if (!undone) return { ok: false };
    next = undone;
  }
  return { ok: true, workspace: next, undone: span };
}
