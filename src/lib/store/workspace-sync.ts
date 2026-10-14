/**
 * Saving a workspace as small patches instead of whole documents. The browser keeps a baseline (what the server
 * last confirmed) per workspace; a save sends only what differs from it: the records added, edited or deleted,
 * new blueprint versions, changed page text and history entries, and the settings or team when they changed.
 *
 * Every record carries a rev from the server. A save names the rev it started from; if someone else saved the
 * record since (a teammate, a public booking), the server refuses and the browser pulls their copy, merges it field
 * by field with its own edits (`mergeRecord`) and saves again.
 */

import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import type { ChangeEntry, Invite, Member, PageDoc, Workspace } from "./workspace-model";

/** The workspace's own settings, stored on the workspace row. */
export type WorkspaceMeta = Pick<
  Workspace,
  "name" | "summary" | "createdAt" | "openedAt" | "currentVersion"
> & {
  source?: Workspace["source"];
  setup?: Workspace["setup"];
};

export type RecordPut = {
  record: DataRecord /** The rev this edit started from; null for a new record. */;
  rev: number | null;
};
export type RecordDelete = { id: string; rev: number };

export type WorkspacePatch = {
  /** The workspace is new: create it, owned by the caller. */
  create?: boolean;
  meta?: WorkspaceMeta;
  versions?: { version: number; blueprint: Blueprint }[];
  records?: { put: RecordPut[]; delete: RecordDelete[] };
  /** Page text by view or block key; null removes it. */
  pages?: Record<string, PageDoc | null>;
  changes?: ChangeEntry[];
  team?: { members: Member[]; invites: Invite[] };
};

export type PatchResult =
  | { ok: true; revs: Record<string, number> }
  | {
      ok: false;
      status: number;
      message: string;
      /** Records someone else saved first; pull and merge, then save again. */
      conflicts?: string[];
      /** The design changed elsewhere: load the workspace again. */
      reload?: boolean;
    };

/** A record as the server has it, with its rev. */
export type StoredRecord = { record: DataRecord; rev: number };

/** What changed on the server since a time: records written (by anyone) and ids deleted. */
export type RecordChanges = { changed: StoredRecord[]; deleted: string[]; syncedAt: string };

/** What the server last confirmed for one workspace. */
export type Baseline = {
  meta: string;
  versions: number;
  /** Absent until the workspace's records are loaded (list summaries carry none). */
  records?: Map<string, StoredRecord>;
  pages: Map<string, string>;
  changes: Map<string, string>;
  team: string;
};

const json = (v: unknown) => JSON.stringify(v ?? null);
export const sameValue = (a: unknown, b: unknown) => a === b || json(a) === json(b);

export function metaOf(ws: Workspace): WorkspaceMeta {
  return {
    name: ws.name,
    summary: ws.summary,
    createdAt: ws.createdAt,
    openedAt: ws.openedAt,
    currentVersion: ws.currentVersion,
    ...(ws.source ? { source: ws.source } : {}),
    ...(ws.setup ? { setup: ws.setup } : {}),
  };
}

const teamOf = (ws: Workspace) => json({ members: ws.members ?? [], invites: ws.invites ?? [] });

/** The baseline for a workspace just read from the server. */
export function baselineOf(ws: Workspace, revs?: Record<string, number>): Baseline {
  const loaded = ws.loaded !== false;
  return {
    meta: json(metaOf(ws)),
    versions: loaded ? ws.versions.length : ws.currentVersion,
    records: loaded
      ? new Map(ws.records.map((r) => [r.id, { record: r, rev: revs?.[r.id] ?? 1 }]))
      : undefined,
    pages: new Map(Object.entries(loaded ? (ws.docs ?? {}) : {}).map(([k, d]) => [k, json(d)])),
    changes: new Map((loaded ? ws.changes : []).map((c) => [c.id, json(c)])),
    team: teamOf(ws),
  };
}

/** What to send so the server matches `ws`, or null when nothing changed. No baseline means a new workspace. */
export function diffWorkspace(base: Baseline | undefined, ws: Workspace): WorkspacePatch | null {
  const loaded = ws.loaded !== false;
  if (!base) {
    if (!loaded) return null;
    return {
      create: true,
      meta: metaOf(ws),
      versions: ws.versions.map((blueprint, i) => ({ version: i + 1, blueprint })),
      records: { put: ws.records.map((record) => ({ record, rev: null })), delete: [] },
      pages: { ...(ws.docs ?? {}) },
      changes: ws.changes,
      team: { members: ws.members ?? [], invites: ws.invites ?? [] },
    };
  }
  const patch: WorkspacePatch = {};
  const meta = metaOf(ws);
  if (json(meta) !== base.meta) patch.meta = meta;
  if (loaded && ws.versions.length > base.versions)
    patch.versions = ws.versions
      .slice(base.versions)
      .map((blueprint, i) => ({ version: base.versions + i + 1, blueprint }));
  if (loaded && base.records) {
    const put: RecordPut[] = [];
    const seen = new Set<string>();
    for (const r of ws.records) {
      seen.add(r.id);
      const was = base.records.get(r.id);
      if (!was) put.push({ record: r, rev: null });
      else if (!sameValue(was.record, r)) put.push({ record: r, rev: was.rev });
    }
    const del: RecordDelete[] = [];
    for (const [id, was] of base.records) if (!seen.has(id)) del.push({ id, rev: was.rev });
    if (put.length || del.length) patch.records = { put, delete: del };
  }
  if (loaded) {
    const pages: Record<string, PageDoc | null> = {};
    const docs = ws.docs ?? {};
    for (const [key, doc] of Object.entries(docs)) if (base.pages.get(key) !== json(doc)) pages[key] = doc;
    for (const key of base.pages.keys()) if (!(key in docs)) pages[key] = null;
    if (Object.keys(pages).length) patch.pages = pages;
    const changes = ws.changes.filter((c) => base.changes.get(c.id) !== json(c));
    if (changes.length) patch.changes = changes;
  }
  if (teamOf(ws) !== base.team) patch.team = { members: ws.members ?? [], invites: ws.invites ?? [] };
  return Object.keys(patch).length ? patch : null;
}

/** The baseline once the server accepted `patch` (later edits stay unsent until the next diff). */
export function afterSave(
  base: Baseline | undefined,
  patch: WorkspacePatch,
  revs: Record<string, number>,
): Baseline {
  const next: Baseline = base
    ? {
        ...base,
        records: base.records && new Map(base.records),
        pages: new Map(base.pages),
        changes: new Map(base.changes),
      }
    : { meta: "", versions: 0, records: new Map(), pages: new Map(), changes: new Map(), team: "" };
  if (patch.meta) next.meta = json(patch.meta);
  if (patch.versions?.length)
    next.versions = Math.max(next.versions, ...patch.versions.map((v) => v.version));
  if (patch.records) {
    next.records ??= new Map();
    for (const p of patch.records.put)
      next.records.set(p.record.id, { record: p.record, rev: revs[p.record.id] ?? (p.rev ?? 0) + 1 });
    for (const d of patch.records.delete) next.records.delete(d.id);
  }
  for (const [key, doc] of Object.entries(patch.pages ?? {}))
    if (doc) next.pages.set(key, json(doc));
    else next.pages.delete(key);
  for (const c of patch.changes ?? []) next.changes.set(c.id, json(c));
  if (patch.team) next.team = json(patch.team);
  return next;
}

/**
 * Someone else saved a record this browser also edited: their copy, with this browser's edits on top. A field this
 * browser changed (compared with the copy it started from) keeps its value; every other field takes theirs. A number
 * both sides changed gets this browser's change added to theirs, so two registers selling the same item both take
 * it off the stock (totals and roll-ups are recalculated after the merge anyway).
 */
export function mergeRecord(base: DataRecord, local: DataRecord, server: DataRecord): DataRecord {
  const data = { ...server.data };
  for (const key of new Set([...Object.keys(base.data), ...Object.keys(local.data)])) {
    const was = base.data[key];
    const mine = local.data[key];
    const theirs = server.data[key];
    if (sameValue(was, mine)) continue;
    if (typeof was === "number" && typeof mine === "number" && typeof theirs === "number" && theirs !== was)
      data[key] = theirs + (mine - was);
    else if (key in local.data) data[key] = mine;
    else delete data[key];
  }
  return {
    ...server,
    data,
    updatedAt: local.updatedAt > server.updatedAt ? local.updatedAt : server.updatedAt,
  };
}

/**
 * Folds server changes into this browser's records. Records nobody edited here take the server's copy, ones edited
 * on both sides are merged, new ones are added and deleted ones dropped. Returns the records (in the same order,
 * new ones last), the ids that arrived new, and the updated baseline records.
 */
export function pullInto(
  records: DataRecord[],
  baseRecords: Map<string, StoredRecord>,
  incoming: RecordChanges,
): { records: DataRecord[]; added: string[]; baseRecords: Map<string, StoredRecord>; changed: boolean } {
  const base = new Map(baseRecords);
  const local = new Map(records.map((r) => [r.id, r]));
  const replaced = new Map<string, DataRecord>();
  const added: DataRecord[] = [];
  let changed = false;
  for (const s of incoming.changed) {
    const was = base.get(s.record.id);
    if (was && was.rev >= s.rev) continue; // Our own save, or older than what we have.
    base.set(s.record.id, s);
    const mine = local.get(s.record.id);
    if (!mine) {
      // Deleted here and not yet saved: the delete goes out with the server's rev. Otherwise it's new to us.
      if (!was) {
        added.push(s.record);
        changed = true;
      }
      continue;
    }
    const next = !was || sameValue(was.record, mine) ? s.record : mergeRecord(was.record, mine, s.record);
    if (!sameValue(next, mine)) {
      replaced.set(mine.id, next);
      changed = true;
    }
  }
  const gone = new Set<string>();
  for (const id of incoming.deleted) {
    if (base.delete(id) || local.has(id)) gone.add(id);
  }
  if (gone.size) changed = true;
  const out = records.filter((r) => !gone.has(r.id)).map((r) => replaced.get(r.id) ?? r);
  return {
    records: [...out, ...added.filter((r) => !gone.has(r.id))],
    added: added.map((r) => r.id),
    baseRecords: base,
    changed,
  };
}
