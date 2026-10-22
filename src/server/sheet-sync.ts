import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { parseCsv, previewImport, type Table } from "@/lib/engine/import";
import { applyImportOps } from "@/lib/engine/records";
import { mappingForHeaders, SYNC_MINUTES, type SyncMapping } from "@/lib/sheet-sync";
import type { RecordPut } from "@/lib/store/workspace-sync";
import { logActivity, recordEntries } from "./activity";
import { db } from "./db";
import { readGoogleSheet, sheetLink } from "./spreadsheet-import";
import { queueChanges, sendSoon } from "./webhooks";
import { currentBlueprint, putRecords, readRecords } from "./workspace-data";
import { enterZone } from "./zone";

/**
 * Google Sheets sync: each run reads the sheet, previews it as an import that updates matching records (by the sync's
 * match field) and adds new ones, and writes only the records that actually changed, inside the workspace lock. Rows
 * with problems are left out and reported; rows removed from the sheet stay. Like an import, a sync doesn't run the
 * save automations; it does log to the activity log and send webhooks, since these are changes happening now.
 */

type Row = {
  id: string;
  workspace_id: string;
  entity_id: string;
  url: string;
  mapping: SyncMapping;
  match_field_id: string;
  defaults: Record<string, string>;
  create_linked: boolean;
  last_run_at: Date | null;
  last_status: "ok" | "error" | null;
  last_result: SyncResult | null;
};

export type SyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  problems: number;
  message: string | null;
  examples?: string[];
};

export type SyncInfo = {
  id: string;
  entityId: string;
  url: string;
  matchFieldId: string;
  columns: number;
  lastRunAt: string | null;
  lastStatus: Row["last_status"];
  lastResult: SyncResult | null;
};

const info = (r: Row): SyncInfo => ({
  id: r.id,
  entityId: r.entity_id,
  url: r.url,
  matchFieldId: r.match_field_id,
  columns: r.mapping.length,
  lastRunAt: r.last_run_at?.toISOString() ?? null,
  lastStatus: r.last_status,
  lastResult: r.last_result,
});

/** A local CSV address for checking sync in development (never in production). */
const devCsv = (url: string) =>
  process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

export const validSource = (url: string) => !!sheetLink(url) || devCsv(url);

async function readSource(url: string): Promise<{ ok: true; table: Table } | { ok: false; message: string }> {
  if (devCsv(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!res?.ok) return { ok: false, message: "The local CSV didn't answer." };
    return { ok: true, table: parseCsv(await res.text()) };
  }
  const read = await readGoogleSheet(url);
  return read.ok ? { ok: true, table: read.sheets[0] } : read;
}

export async function listSyncs(workspaceId: string): Promise<SyncInfo[]> {
  const { rows } =
    await sql<Row>`select * from sheet_sync where workspace_id = ${workspaceId} order by created_at`.execute(
      db,
    );
  return rows.map(info);
}

export async function createSync(
  workspaceId: string,
  userId: string,
  input: {
    entityId: string;
    url: string;
    mapping: SyncMapping;
    matchFieldId: string;
    defaults: Record<string, string>;
    createLinked: boolean;
  },
): Promise<{ ok: true; sync: SyncInfo } | { ok: false; message: string }> {
  if (!validSource(input.url)) return { ok: false, message: "Sync works with a Google Sheets link." };
  const bp = await currentBlueprint(db, workspaceId);
  enterZone(bp);
  const entity = bp?.entities.find((e) => e.id === input.entityId);
  if (!entity) return { ok: false, message: "That record type doesn't exist." };
  if (!input.mapping.some((m) => m.fieldId === input.matchFieldId))
    return {
      ok: false,
      message: "Choose a column that identifies each row (a name or code) to keep it in sync.",
    };
  const id = `ss_${randomBytes(9).toString("base64url")}`;
  await sql`insert into sheet_sync (id, workspace_id, entity_id, url, mapping, match_field_id, defaults, create_linked, created_by, last_run_at)
    values (${id}, ${workspaceId}, ${input.entityId}, ${input.url}, ${JSON.stringify(input.mapping)}::jsonb, ${input.matchFieldId},
      ${JSON.stringify(input.defaults)}::jsonb, ${input.createLinked}, ${userId}, now())
    on conflict (workspace_id, entity_id) do update set id = excluded.id, url = excluded.url, mapping = excluded.mapping,
      match_field_id = excluded.match_field_id, defaults = excluded.defaults, create_linked = excluded.create_linked,
      created_by = excluded.created_by, created_at = now(), last_run_at = now(), last_status = null, last_result = null`.execute(
    db,
  );
  // The import that set this up is still being saved from the browser: the first run waits for the next pass, so it
  // sees those rows and updates them instead of adding them again.
  const { rows } = await sql<Row>`select * from sheet_sync where id = ${id}`.execute(db);
  return { ok: true, sync: info(rows[0]) };
}

export async function removeSync(workspaceId: string, id: string) {
  const done = await sql`delete from sheet_sync where workspace_id = ${workspaceId} and id = ${id}`.execute(
    db,
  );
  return Number(done.numAffectedRows ?? 0) > 0;
}

async function finish(id: string, status: "ok" | "error", result: SyncResult) {
  await sql`update sheet_sync set last_run_at = now(), last_status = ${status}, last_result = ${JSON.stringify(result)}::jsonb
    where id = ${id}`.execute(db);
  return result;
}

/** Whether two records hold the same data, whatever their key order or updatedAt: a sync rewrites nothing that's the same. */
const sameData = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null),
  );

const failed = (message: string): SyncResult => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  problems: 0,
  message,
});

/** Runs one sync now: reads the sheet, then adds and updates records in one locked write. */
export async function runSync(workspaceId: string, id: string, now = new Date()): Promise<SyncResult | null> {
  const { rows } =
    await sql<Row>`select * from sheet_sync where workspace_id = ${workspaceId} and id = ${id}`.execute(db);
  const row = rows[0];
  if (!row) return null;
  const source = await readSource(row.url);
  if (!source.ok) return finish(id, "error", failed(source.message));
  const { mapping, missing } = mappingForHeaders(source.table.headers, row.mapping);
  if (missing.length)
    return finish(
      id,
      "error",
      failed(
        `The sheet has no "${missing.join('", "')}" column any more. Put it back, or set the sync up again from Import.`,
      ),
    );
  let hooks = 0;
  const result = await db.transaction().execute(async (trx): Promise<SyncResult> => {
    await sql`select 1 from workspace where id = ${workspaceId} for update`.execute(trx);
    const bp = await currentBlueprint(trx, workspaceId);
    enterZone(bp);
    if (!bp?.entities.some((e) => e.id === row.entity_id))
      return failed("The record type this sheet fills is gone.");
    const stored = await readRecords(trx, workspaceId);
    const ws = { blueprint: bp, records: stored.map((s) => s.record) };
    const preview = previewImport(
      ws,
      row.entity_id,
      source.table,
      {
        mapping,
        matchFieldId: row.match_field_id,
        onMatch: "update",
        addOptions: false,
        createLinked: row.create_linked,
        defaults: row.defaults,
      },
      now,
    );
    const done = applyImportOps(ws, preview.plan.recordOps ?? [], now);
    const before = new Map(stored.map((s) => [s.record.id, s]));
    const puts = done.data.records.flatMap((r): RecordPut[] => {
      const was = before.get(r.id);
      if (!was) return [{ record: r, rev: null }];
      return sameData(was.record.data, r.data) ? [] : [{ record: r, rev: was.rev }];
    });
    if (puts.length) {
      const put = await putRecords(trx, workspaceId, puts, {
        type: "sheet_sync",
        id: row.id,
        name: "Google Sheets sync",
      });
      if (put.conflicts.length) throw new Error(`sheet sync conflicted on ${put.conflicts.join(", ")}`);
      await sql`update workspace set updated_at = now() where id = ${workspaceId}`.execute(trx);
      await logActivity(
        trx,
        { type: "sheet_sync", id: row.id, name: "Google Sheets sync" },
        recordEntries(workspaceId, puts),
      );
      hooks = await queueChanges(
        trx,
        workspaceId,
        bp,
        puts.map((p) => ({ before: before.get(p.record.id)?.record, after: p.record })),
      );
    }
    const mine = puts.filter((p) => p.record.entityId === row.entity_id);
    const bad = preview.rows.filter((r) => r.action === "error");
    return {
      created: mine.filter((p) => p.rev === null).length,
      updated: mine.filter((p) => p.rev !== null).length,
      unchanged: preview.rows.length - bad.length - mine.length,
      problems: bad.length + done.errors.length,
      message: null,
      ...(bad.length
        ? { examples: bad.slice(0, 3).map((r) => `Row ${r.row}: ${r.problems.join("; ")}`) }
        : {}),
    };
  });
  sendSoon(hooks);
  return finish(id, result.message ? "error" : "ok", result);
}

/** The cron job's pass: syncs whose last run is SYNC_MINUTES old (a few a run). */
export async function runDueSyncs(limit = 10) {
  const { rows } = await sql<{ id: string; workspace_id: string }>`select id, workspace_id from sheet_sync
    where last_run_at is null or last_run_at < now() - make_interval(mins => ${SYNC_MINUTES - 1})
    order by last_run_at nulls first limit ${limit}`.execute(db);
  for (const r of rows)
    await runSync(r.workspace_id, r.id).catch((e) => finish(r.id, "error", failed(String(e).slice(0, 200))));
  return rows.length;
}
