import "server-only";
import { sql } from "kysely";
import { db } from "./db";
import { roleIn } from "./workspaces";

export type ThreadSummary = { id: string; title: string; updatedAt: string; turns: number };
export type Thread = Omit<ThreadSummary, "turns"> & { turns: unknown[] };

const ID = /^thread_[a-z0-9]{6,40}$/;

/** The person's own conversations in a workspace they can open, newest first. */
export async function listThreads(workspaceId: string, userId: string): Promise<ThreadSummary[] | null> {
  if (!(await roleIn(workspaceId, userId))) return null;
  const { rows } = await sql<{ id: string; title: string; updated_at: Date; count: number }>`
    select id, title, updated_at, jsonb_array_length(turns) as count from assistant_thread
    where workspace_id = ${workspaceId} and user_id = ${userId}
    order by updated_at desc limit 50`.execute(db);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at.toISOString(),
    turns: r.count,
  }));
}

/** One conversation, only for the person who had it and only while they can still open the workspace. */
export async function getThread(
  id: string,
  userId: string,
): Promise<(Thread & { workspaceId: string }) | null> {
  if (!ID.test(id)) return null;
  const { rows } = await sql<{ workspace_id: string; title: string; updated_at: Date; turns: unknown[] }>`
    select workspace_id, title, updated_at, turns from assistant_thread where id = ${id} and user_id = ${userId}`.execute(
    db,
  );
  const row = rows[0];
  if (!row || !(await roleIn(row.workspace_id, userId))) return null;
  return {
    id,
    workspaceId: row.workspace_id,
    title: row.title,
    updatedAt: row.updated_at.toISOString(),
    turns: row.turns,
  };
}

/** Creates or updates a conversation. Someone else's thread id is refused, never overwritten. */
export async function saveThread(
  input: { id: string; workspaceId: string; title: string; turns: unknown[] },
  userId: string,
): Promise<boolean> {
  if (!ID.test(input.id) || !(await roleIn(input.workspaceId, userId))) return false;
  const { rows } = await sql<{ id: string }>`
    insert into assistant_thread (id, workspace_id, user_id, title, turns)
    values (${input.id}, ${input.workspaceId}, ${userId}, ${input.title}, ${JSON.stringify(input.turns)}::jsonb)
    on conflict (id) do update set title = excluded.title, turns = excluded.turns, updated_at = now()
      where assistant_thread.user_id = excluded.user_id and assistant_thread.workspace_id = excluded.workspace_id
    returning id`.execute(db);
  return rows.length > 0;
}
