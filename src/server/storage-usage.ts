import "server-only";
import { sql } from "kysely";
import { db } from "./db";

/**
 * How much room a workspace's files take, and its limit: WORKSPACE_STORAGE_MB (default 1 GB). Every stored file has a
 * file_upload row (recordUpload), so this never lists the bucket. When plans arrive, the limit can come from the plan.
 */
export const WORKSPACE_STORAGE_BYTES =
  Math.max(1, Number(process.env.WORKSPACE_STORAGE_MB ?? 1000)) * 1_000_000;

/** A workspace has no room for a file. Routes turn it into a 403 with this message. */
export class StorageFullError extends Error {}

export function storageLimitResult(error: unknown): { ok: false; status: 403; message: string } {
  if (error instanceof StorageFullError) return { ok: false, status: 403, message: error.message };
  throw error;
}

export async function workspaceStorageUsed(workspaceId: string): Promise<number> {
  const { rows } = await sql<{ bytes: string | null }>`
    select sum(bytes) as bytes from file_upload where workspace_id = ${workspaceId}`.execute(db);
  return Number(rows[0]?.bytes ?? 0);
}

/** Before the team stores a file. Files visitors send on public pages are counted but never refused. */
export async function assertStorageRoom(workspaceId: string, bytes: number) {
  const used = await workspaceStorageUsed(workspaceId);
  if (used + bytes > WORKSPACE_STORAGE_BYTES)
    throw new StorageFullError(
      `This workspace has used its ${Math.round(WORKSPACE_STORAGE_BYTES / 1_000_000).toLocaleString("en-US")} MB of file storage. Delete files you no longer need in Documents to make room.`,
    );
}

/** Logs a stored file: its size for the storage limit, and what Documents lists about it. */
export async function recordUpload(
  workspaceId: string,
  name: string,
  bytes: number,
  details: {
    displayName?: string;
    contentType?: string;
    source?: "upload" | "export" | "record";
    folder?: string | null;
    by?: { id: string; name: string } | null;
  } = {},
) {
  await sql`insert into file_upload (name, workspace_id, bytes, display_name, content_type, source, folder, added_by, added_by_name)
    values (${name}, ${workspaceId}, ${bytes}, ${details.displayName ?? null}, ${details.contentType ?? null},
      ${details.source ?? "record"}, ${details.folder ?? null}, ${details.by?.id ?? null}, ${details.by?.name ?? null})
    on conflict (name) do nothing`
    .execute(db)
    .catch((error) =>
      console.warn(JSON.stringify({ event: "file_upload_log_error", message: String(error) })),
    );
}
