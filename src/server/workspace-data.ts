import "server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import type { ChangeEntry, PageDoc, WorkspaceDoc } from "@/lib/store/workspace-model";
import type { RecordChanges, RecordPut, StoredRecord, WorkspaceMeta } from "@/lib/store/workspace-sync";
import type { Database } from "./db";

/**
 * The workspace tables (migration 0006): the workspace row keeps its settings in `doc` (WorkspaceMeta); records,
 * blueprint versions, history and page text have a table each. Everything here takes a connection or transaction.
 */
type Ex = Kysely<Database> | Transaction<Database>;

type RecordRow = {
  id: string;
  entity_id: string;
  data: DataRecord["data"];
  created_at: Date;
  updated_at: Date;
  rev: number;
};
const toStored = (r: RecordRow): StoredRecord => ({
  record: {
    id: r.id,
    entityId: r.entity_id,
    data: r.data,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  },
  rev: r.rev,
});

/** The settings part of a workspace document. */
export function metaFrom(doc: WorkspaceDoc | WorkspaceMeta): WorkspaceMeta {
  return {
    name: doc.name,
    summary: doc.summary,
    createdAt: doc.createdAt,
    openedAt: doc.openedAt,
    currentVersion: doc.currentVersion,
    ...(doc.source ? { source: doc.source } : {}),
    ...(doc.setup ? { setup: doc.setup } : {}),
  };
}

export async function readRecords(ex: Ex, workspaceId: string): Promise<StoredRecord[]> {
  const { rows } = await sql<RecordRow>`
    select id, entity_id, data, created_at, updated_at, rev from workspace_record
    where workspace_id = ${workspaceId} order by seq`.execute(ex);
  return rows.map(toStored);
}

/** Records written and deleted after `since` (with a few seconds' overlap for writes still committing). */
export async function recordChangesSince(ex: Ex, workspaceId: string, since: string): Promise<RecordChanges> {
  const from = Number.isNaN(Date.parse(since)) ? new Date(0) : new Date(Date.parse(since) - 5000);
  const [{ rows: now }, { rows: changed }, { rows: deleted }] = await Promise.all([
    sql<{ now: Date }>`select now() as now`.execute(ex),
    sql<RecordRow>`
      select id, entity_id, data, created_at, updated_at, rev from workspace_record
      where workspace_id = ${workspaceId} and changed_at > ${from} order by seq`.execute(ex),
    sql<{ id: string }>`
      select id from workspace_record_deleted where workspace_id = ${workspaceId} and deleted_at > ${from}`.execute(
      ex,
    ),
  ]);
  return {
    changed: changed.map(toStored),
    deleted: deleted.map((d) => d.id),
    syncedAt: (now[0]?.now ?? new Date()).toISOString(),
  };
}

/** A whole workspace: settings plus every version, record, history entry and page, with each record's rev. */
export async function readWorkspace(
  ex: Ex,
  id: string,
): Promise<{ doc: WorkspaceDoc; revs: Record<string, number>; syncedAt: string } | null> {
  const [meta, versions, records, changes, pages, now] = await Promise.all([
    sql<{ doc: WorkspaceMeta }>`select doc from workspace where id = ${id}`.execute(ex),
    sql<{ version: number; blueprint: Blueprint }>`
      select version, blueprint from workspace_version where workspace_id = ${id} order by version`.execute(
      ex,
    ),
    readRecords(ex, id),
    sql<{ entry: ChangeEntry }>`
      select entry from workspace_change where workspace_id = ${id} order by applied_at desc, id desc`.execute(
      ex,
    ),
    sql<{ key: string; body: string; updated_at: Date }>`
      select key, body, updated_at from workspace_page where workspace_id = ${id}`.execute(ex),
    sql<{ now: Date }>`select now() as now`.execute(ex),
  ]);
  const settings = meta.rows[0]?.doc;
  if (!settings) return null;
  const docs: Record<string, PageDoc> = {};
  for (const p of pages.rows) docs[p.key] = { body: p.body, updatedAt: p.updated_at.toISOString() };
  return {
    doc: {
      ...metaFrom(settings),
      slug: id,
      versions: versions.rows.map((v) => v.blueprint),
      records: records.map((r) => r.record),
      changes: changes.rows.map((c) => c.entry),
      ...(pages.rows.length ? { docs } : {}),
    },
    revs: Object.fromEntries(records.map((r) => [r.record.id, r.rev])),
    syncedAt: (now.rows[0]?.now ?? new Date()).toISOString(),
  };
}

/** What a public page needs: settings, the current blueprint, records and page text (no history or old versions). */
export async function readCurrent(ex: Ex, id: string) {
  const [meta, blueprint, records, pages] = await Promise.all([
    sql<{ doc: WorkspaceMeta }>`select doc from workspace where id = ${id}`.execute(ex),
    currentBlueprint(ex, id),
    readRecords(ex, id),
    sql<{ key: string; body: string; updated_at: Date }>`
      select key, body, updated_at from workspace_page where workspace_id = ${id}`.execute(ex),
  ]);
  const settings = meta.rows[0]?.doc;
  if (!settings || !blueprint) return null;
  const docs: Record<string, PageDoc> = {};
  for (const p of pages.rows) docs[p.key] = { body: p.body, updatedAt: p.updated_at.toISOString() };
  return { meta: metaFrom(settings), blueprint, records: records.map((r) => r.record), docs };
}

/** The current blueprint of a workspace. */
export async function currentBlueprint(ex: Ex, id: string): Promise<Blueprint | undefined> {
  const { rows } = await sql<{ blueprint: Blueprint }>`
    select v.blueprint from workspace w
    join workspace_version v on v.workspace_id = w.id and v.version = (w.doc->>'currentVersion')::int
    where w.id = ${id}`.execute(ex);
  return rows[0]?.blueprint;
}

/** Fills a workspace's tables from a whole document (new workspaces, demo seeding and resets). */
export async function writeContent(trx: Ex, id: string, doc: WorkspaceDoc) {
  if (doc.versions.length)
    await sql`insert into workspace_version (workspace_id, version, blueprint)
      select ${id}, v.n::int, v.bp from jsonb_array_elements(${JSON.stringify(doc.versions)}::jsonb) with ordinality as v(bp, n)
      on conflict (workspace_id, version) do update set blueprint = excluded.blueprint`.execute(trx);
  await insertRecords(trx, id, doc.records);
  if (doc.changes.length)
    await sql`insert into workspace_change (workspace_id, id, applied_at, entry)
      select ${id}, c->>'id', (c->>'appliedAt')::timestamptz, c from jsonb_array_elements(${JSON.stringify(doc.changes)}::jsonb) c
      on conflict (workspace_id, id) do update set entry = excluded.entry, applied_at = excluded.applied_at`.execute(
      trx,
    );
  const pages = Object.entries(doc.docs ?? {});
  if (pages.length) await writePages(trx, id, Object.fromEntries(pages));
}

/** Adds records (new ids only), in order. Returns the ids that already existed. */
export async function insertRecords(trx: Ex, id: string, records: DataRecord[]): Promise<string[]> {
  if (!records.length) return [];
  const { rows } = await sql<{ id: string }>`
    insert into workspace_record (workspace_id, id, entity_id, data, created_at, updated_at)
    select ${id}, x.id, x."entityId", coalesce(x.data, '{}'::jsonb), x."createdAt", coalesce(x."updatedAt", x."createdAt")
    from rows from (
      jsonb_to_recordset(${JSON.stringify(records)}::jsonb)
        as (id text, "entityId" text, data jsonb, "createdAt" timestamptz, "updatedAt" timestamptz)
    ) with ordinality as x(id, "entityId", data, "createdAt", "updatedAt", n)
    order by x.n
    on conflict (workspace_id, id) do nothing
    returning id`.execute(trx);
  const inserted = new Set(rows.map((r) => r.id));
  return records.filter((r) => !inserted.has(r.id)).map((r) => r.id);
}

/**
 * Writes edited and new records in one statement each, checking revs: an edit only lands if the stored rev is the
 * one it started from, and a new record only if its id is free. Returns the new revs and the ids that conflicted
 * (the caller rolls back when there are any).
 */
export async function putRecords(
  trx: Ex,
  id: string,
  puts: RecordPut[],
): Promise<{ revs: Record<string, number>; conflicts: string[] }> {
  const revs: Record<string, number> = {};
  const conflicts: string[] = [];
  const fresh = puts.filter((p) => p.rev === null).map((p) => p.record);
  for (const taken of await insertRecords(trx, id, fresh)) conflicts.push(taken);
  for (const r of fresh) if (!conflicts.includes(r.id)) revs[r.id] = 1;
  const edits = puts.filter((p) => p.rev !== null);
  if (edits.length) {
    const input = edits.map((p) => ({ ...p.record, rev: p.rev }));
    const { rows } = await sql<{ id: string; rev: number }>`
      update workspace_record r set entity_id = x."entityId", data = coalesce(x.data, '{}'::jsonb),
        updated_at = coalesce(x."updatedAt", r.updated_at), rev = r.rev + 1, changed_at = now()
      from jsonb_to_recordset(${JSON.stringify(input)}::jsonb) as
        x(id text, "entityId" text, data jsonb, "updatedAt" timestamptz, rev int)
      where r.workspace_id = ${id} and r.id = x.id and r.rev = x.rev
      returning r.id, r.rev`.execute(trx);
    for (const row of rows) revs[row.id] = row.rev;
    for (const p of edits) if (!(p.record.id in revs)) conflicts.push(p.record.id);
  }
  return { revs, conflicts };
}

/** Deletes records at the revs the caller last saw. Returns ids that were changed by someone else first. */
export async function deleteRecords(
  trx: Ex,
  id: string,
  dels: { id: string; rev: number | null }[],
): Promise<string[]> {
  if (!dels.length) return [];
  const { rows } = await sql<{ id: string }>`
    delete from workspace_record r using jsonb_to_recordset(${JSON.stringify(dels)}::jsonb) as x(id text, rev int)
    where r.workspace_id = ${id} and r.id = x.id and (x.rev is null or r.rev = x.rev)
    returning r.id`.execute(trx);
  const done = rows.map((r) => r.id);
  if (done.length) {
    await sql`insert into workspace_record_deleted (workspace_id, id)
      select ${id}, unnest(${done}::text[]) on conflict (workspace_id, id) do update set deleted_at = now()`.execute(
      trx,
    );
    await sql`delete from workspace_record_deleted where workspace_id = ${id} and deleted_at < now() - interval '30 days'`.execute(
      trx,
    );
  }
  const left = dels.filter((d) => !done.includes(d.id)).map((d) => d.id);
  if (!left.length) return [];
  // Already gone is fine (deleted twice); still there at another rev is a conflict.
  const { rows: still } = await sql<{ id: string }>`
    select id from workspace_record where workspace_id = ${id} and id = any(${left}::text[])`.execute(trx);
  return still.map((r) => r.id);
}

/** Saves page text; null removes a page's text. */
export async function writePages(trx: Ex, id: string, pages: Record<string, PageDoc | null>) {
  const put = Object.entries(pages).flatMap(([key, d]) =>
    d ? [{ key, body: d.body, updatedAt: d.updatedAt || new Date().toISOString() }] : [],
  );
  const gone = Object.entries(pages).flatMap(([key, d]) => (d ? [] : [key]));
  if (put.length)
    await sql`insert into workspace_page (workspace_id, key, body, updated_at)
      select ${id}, x.key, x.body, x."updatedAt" from jsonb_to_recordset(${JSON.stringify(put)}::jsonb) as
        x(key text, body text, "updatedAt" timestamptz)
      on conflict (workspace_id, key) do update set body = excluded.body, updated_at = excluded.updated_at`.execute(
      trx,
    );
  if (gone.length)
    await sql`delete from workspace_page where workspace_id = ${id} and key = any(${gone}::text[])`.execute(
      trx,
    );
}

/** Saves history entries (new or updated, e.g. marked undone). */
export async function writeChanges(trx: Ex, id: string, entries: ChangeEntry[]) {
  if (!entries.length) return;
  await sql`insert into workspace_change (workspace_id, id, applied_at, entry)
    select ${id}, c->>'id', (c->>'appliedAt')::timestamptz, c from jsonb_array_elements(${JSON.stringify(entries)}::jsonb) c
    on conflict (workspace_id, id) do update set entry = excluded.entry`.execute(trx);
}

/** Removes everything but the workspace row, so a whole document can be written again (demo reset). */
export async function clearContent(trx: Ex, id: string) {
  for (const table of [
    "workspace_record",
    "workspace_version",
    "workspace_change",
    "workspace_page",
  ] as const)
    await sql`delete from ${sql.table(table)} where workspace_id = ${id}`.execute(trx);
}
