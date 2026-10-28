/**
 * Lists files stored before Documents kept a list (src/lib/documents.ts has the bucket layout): every object under a
 * workspace's folder that has no file_upload row gets one, with its size and type from storage, so Documents and
 * the plan's storage both see it. ai/ (Ask EveryOps attachments) is left out. Prints what it would add unless
 * --apply is given; safe to run again.
 *
 *   tsx --conditions=react-server --env-file=.env.local scripts/backfill-documents.mts [--apply]
 */
import { sql } from "kysely";
import { db } from "@/server/db";
import { uploadsBucket } from "@/server/storage";

const apply = process.argv.includes("--apply");

async function main() {
  const { rows: workspaces } = await sql<{ id: string }>`select id from workspace`.execute(db);
  const { rows: known } = await sql<{ name: string }>`select name from file_upload`.execute(db);
  const listed = new Set(known.map((r) => r.name));
  let missing = 0;
  let bytes = 0;
  for (const { id } of workspaces) {
    const [files] = await uploadsBucket().getFiles({ prefix: `${id}/` });
    for (const file of files) {
      if (listed.has(file.name)) continue;
      const size = Number(file.metadata.size ?? 0);
      const folder = file.name.split("/")[1];
      const source = folder === "files" ? "upload" : folder === "exports" ? "export" : "record";
      missing++;
      bytes += size;
      if (apply)
        await sql`insert into file_upload (name, workspace_id, bytes, at, content_type, source)
          values (${file.name}, ${id}, ${size}, ${file.metadata.timeCreated ?? new Date().toISOString()}, ${file.metadata.contentType ?? null}, ${source})
          on conflict (name) do nothing`.execute(db);
    }
  }
  console.log(JSON.stringify({ workspaces: workspaces.length, missing, bytes, applied: apply }));
  await db.destroy();
}

main().catch(async (error) => {
  console.error(error);
  await db.destroy();
  process.exit(1);
});
