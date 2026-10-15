import "server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  applyMemoryEdits,
  EMPTY_MEMORY,
  MAX_INSTRUCTIONS,
  type MemoryEdit,
  type MemoryNote,
  type MemorySource,
  type WorkspaceMemory,
} from "@/lib/assistant/memory";
import { type Database, db } from "./db";

type Ex = Kysely<Database> | Transaction<Database>;
type Row = { instructions: string; notes: MemoryNote[]; updated_at: Date };

const toMemory = (row: Row | undefined): WorkspaceMemory =>
  row
    ? { instructions: row.instructions, notes: row.notes ?? [], updatedAt: row.updated_at.toISOString() }
    : EMPTY_MEMORY;

/** A workspace's memory. Access is checked by the caller. */
export async function readMemory(workspaceId: string, ex: Ex = db): Promise<WorkspaceMemory> {
  const { rows } = await sql<Row>`select instructions, notes, updated_at from workspace_memory
    where workspace_id = ${workspaceId}`.execute(ex);
  return toMemory(rows[0]);
}

/** The row, locked for this transaction (created empty first if the workspace has none yet). */
async function lockMemory(trx: Transaction<Database>, workspaceId: string) {
  await sql`insert into workspace_memory (workspace_id) values (${workspaceId}) on conflict do nothing`.execute(
    trx,
  );
  const { rows } = await sql<Row>`select instructions, notes, updated_at from workspace_memory
    where workspace_id = ${workspaceId} for update`.execute(trx);
  return toMemory(rows[0]);
}

async function writeNotes(trx: Ex, workspaceId: string, notes: MemoryNote[], instructions?: string) {
  await sql`update workspace_memory set notes = ${JSON.stringify(notes)}::jsonb,
    instructions = coalesce(${instructions ?? null}, instructions), updated_at = now()
    where workspace_id = ${workspaceId}`.execute(trx);
}

/** Applies edits inside an open transaction (setup's seed runs inside the workspace save). */
export async function applyEditsIn(
  trx: Transaction<Database>,
  workspaceId: string,
  edits: MemoryEdit[],
  source: MemorySource,
) {
  if (!edits.length) return { notes: [], added: [], updated: [], removed: [] };
  const memory = await lockMemory(trx, workspaceId);
  const result = applyMemoryEdits(memory.notes, edits, source);
  if (result.added.length || result.updated.length || result.removed.length)
    await writeNotes(trx, workspaceId, result.notes);
  return result;
}

/** Notes from a conversation. Returns what changed, so the panel can say what it remembered. */
export function rememberEdits(workspaceId: string, edits: MemoryEdit[], source: MemorySource = "assistant") {
  return db.transaction().execute((trx) => applyEditsIn(trx, workspaceId, edits, source));
}

/**
 * The owner's edit from Settings: new instructions and the notes as they kept them (edited, removed or added).
 * Notes keep their ids and sources; text the owner changed or added counts as theirs.
 */
export async function saveMemory(
  workspaceId: string,
  input: { instructions: string; notes: { id?: string; kind: MemoryNote["kind"]; text: string }[] },
): Promise<WorkspaceMemory> {
  return db.transaction().execute(async (trx) => {
    const memory = await lockMemory(trx, workspaceId);
    const byId = new Map(memory.notes.map((n) => [n.id, n]));
    const kept = new Set(input.notes.flatMap((n) => (n.id && byId.has(n.id) ? [n.id] : [])));
    const edits: MemoryEdit[] = [
      ...memory.notes.filter((n) => !kept.has(n.id)).map((n) => ({ action: "remove" as const, id: n.id })),
      ...input.notes.flatMap((n): MemoryEdit[] => {
        const was = n.id ? byId.get(n.id) : undefined;
        if (!was) return [{ action: "add", kind: n.kind, text: n.text }];
        return was.text === n.text.trim() && was.kind === n.kind
          ? []
          : [{ action: "update", id: was.id, text: n.text, kind: n.kind }];
      }),
    ];
    const result = applyMemoryEdits(memory.notes, edits, "owner");
    const changed = new Set(result.updated.map((n) => n.id));
    const notes = result.notes.map((n) => (changed.has(n.id) ? { ...n, source: "owner" as const } : n));
    await writeNotes(trx, workspaceId, notes, input.instructions.slice(0, MAX_INSTRUCTIONS));
    const { rows } = await sql<Row>`select instructions, notes, updated_at from workspace_memory
      where workspace_id = ${workspaceId}`.execute(trx);
    return toMemory(rows[0]);
  });
}
