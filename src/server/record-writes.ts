import "server-only";
import { sql } from "kysely";
import type { DataRecord, RecordData } from "@/lib/blueprint/types";
import { newId } from "@/lib/engine/ids";
import { applyRecordOps, createRecord, updateRecord } from "@/lib/engine/records";
import { autoReferenceFields, nextReference } from "@/lib/engine/references";
import { type RecordPut, sameValue } from "@/lib/store/workspace-sync";
import { deliverSoon, fireOnSave, logSaveRuns } from "./automations";
import { db } from "./db";
import { currentBlueprint, deleteRecords, putRecords, readRecords, writePages } from "./workspace-data";

/**
 * Record writes from outside the app (MCP tools, the REST API): one record at a time, through the same engine as
 * the app (validation, double bookings, formulas, save automations), inside the workspace lock browser saves take.
 * Only the records that changed are written, each bumping its rev, so open tabs merge them. A caller that read a
 * record may send its rev; when someone saved it since, the write is refused with the current record.
 */

export type WriteResult =
  | { ok: true; record: DataRecord | null; rev: number | null; notices: string[] }
  | { ok: false; status: 400 | 404 | 409; message: string; current?: { record: DataRecord; rev: number } };

type Change =
  | { kind: "create"; entityId: string; data: RecordData }
  | { kind: "update"; id: string; patch: RecordData; rev?: number }
  | { kind: "delete"; id: string; rev?: number };

export async function writeRecord(slug: string, change: Change, now = new Date()): Promise<WriteResult> {
  let emailRuns: number[] = [];
  const result = await db.transaction().execute(async (trx): Promise<WriteResult> => {
    await sql`select 1 from workspace where id = ${slug} for update`.execute(trx);
    const bp = await currentBlueprint(trx, slug);
    if (!bp) return { ok: false, status: 404, message: "Workspace not found." };
    const stored = await readRecords(trx, slug);
    const before = new Map(stored.map((s) => [s.record.id, s]));
    const ws = { blueprint: bp, records: stored.map((s) => s.record) };
    const target = change.kind === "create" ? undefined : before.get(change.id);
    if (change.kind !== "create") {
      if (!target) return { ok: false, status: 404, message: `No record "${change.id}".` };
      if (change.rev !== undefined && change.rev !== target.rev)
        return {
          ok: false,
          status: 409,
          message: "Someone changed this record since you read it. Here it is now; apply your change to it.",
          current: target,
        };
    }
    let next: DataRecord[];
    let saved: DataRecord | null = null;
    let notices: string[] = [];
    if (change.kind === "create") {
      // Reference numbers the app fills in itself (BK-1042) are filled in here too, as for public bookings.
      const entity = bp.entities.find((e) => e.id === change.entityId);
      const data = { ...change.data };
      if (entity)
        for (const f of autoReferenceFields(entity))
          if (data[f.id] === undefined || data[f.id] === "")
            data[f.id] = nextReference(entity, f, ws.records);
      const made = createRecord(ws, change.entityId, data, now, newId(change.entityId));
      if (!made.ok) return { ok: false, status: 400, message: made.errors.map((e) => e.message).join("; ") };
      next = made.data.records;
      saved = made.record;
      notices = made.notices;
    } else if (change.kind === "update") {
      const made = updateRecord(ws, change.id, change.patch, now);
      if (!made.ok) return { ok: false, status: 400, message: made.errors.map((e) => e.message).join("; ") };
      next = made.data.records;
      saved = made.record;
      notices = made.notices;
    } else {
      const done = applyRecordOps(ws, [{ op: "delete_record", recordId: change.id }], now);
      if (done.errors.length) return { ok: false, status: 400, message: done.errors.join("; ") };
      next = done.data.records;
    }
    const kept = new Set(next.map((r) => r.id));
    const puts = next.flatMap((r): RecordPut[] => {
      const was = before.get(r.id);
      if (!was) return [{ record: r, rev: null }];
      return sameValue(was.record, r) ? [] : [{ record: r, rev: was.rev }];
    });
    const gone = stored.filter((s) => !kept.has(s.record.id)).map((s) => ({ id: s.record.id, rev: s.rev }));
    const put = await putRecords(trx, slug, puts);
    const conflicts = [...put.conflicts, ...(await deleteRecords(trx, slug, gone))];
    if (conflicts.length) throw new Error(`record write conflicted on ${conflicts.join(", ")}`);
    if (fireOnSave(bp) && puts.length)
      emailRuns = await logSaveRuns(
        trx,
        slug,
        bp,
        puts.map((p) => ({ before: before.get(p.record.id)?.record, after: p.record })),
        next,
        "save",
        now,
      );
    await sql`update workspace set updated_at = now() where id = ${slug}`.execute(trx);
    const savedId = saved?.id;
    return {
      ok: true,
      record: savedId ? (next.find((r) => r.id === savedId) ?? saved) : null,
      rev: savedId ? (put.revs[savedId] ?? null) : null,
      notices,
    };
  });
  deliverSoon(emailRuns);
  return result;
}

/** A page's text (document and custom HTML pages), or null when it has none. */
export async function readPage(slug: string, key: string): Promise<string | null> {
  const { rows } = await sql<{ body: string }>`
    select body from workspace_page where workspace_id = ${slug} and key = ${key}`.execute(db);
  return rows[0]?.body ?? null;
}

/**
 * Replaces a page's text inside the workspace lock, keeping the text it replaces as a version (writePages), and
 * answers when it was saved. Open tabs pick it up on their next sync.
 */
export async function writePageText(slug: string, key: string, body: string): Promise<string> {
  const updatedAt = new Date().toISOString();
  await db.transaction().execute(async (trx) => {
    await sql`select 1 from workspace where id = ${slug} for update`.execute(trx);
    await writePages(trx, slug, { [key]: { body, updatedAt } });
    await sql`update workspace set updated_at = now() where id = ${slug}`.execute(trx);
  });
  return updatedAt;
}
