import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  cleanFileName,
  type DocumentSource,
  type DocumentsUsage,
  extOf,
  kindOf,
  MAX_DOCUMENT_FILE_BYTES,
  type WorkspaceDocument,
} from "@/lib/documents";
import { db } from "./db";
import { imageType, uploadsBucket } from "./storage";
import { assertStorageRoom, recordUpload, WORKSPACE_STORAGE_BYTES } from "./storage-usage";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

/**
 * What a Documents file really is, from its first bytes, checked against its name: pictures, PDF, Office files (zip
 * containers), video and audio (MP4/MOV/M4A boxes, WebM, MP3, WAV), and UTF-8 text (CSV, TXT, Markdown, JSON)
 * without markup. HTML, SVG, programs and anything else are refused, so nothing stored can run in a browser.
 */
export function documentFileType(bytes: Uint8Array, filename: string): { ext: string; mime: string } | null {
  const ext = extOf(filename);
  const image = imageType(bytes);
  if (image) return image;
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  const ascii = (offset: number, text: string) => at(offset, ...[...text].map((c) => c.charCodeAt(0)));
  if (ascii(0, "%PDF")) return { ext: "pdf", mime: MIME.pdf };
  if (at(0, 0x50, 0x4b, 0x03, 0x04) && (ext === "docx" || ext === "xlsx" || ext === "pptx"))
    return { ext, mime: MIME[ext] };
  if (ascii(4, "ftyp")) {
    if (ext === "mov" || ascii(8, "qt  ")) return { ext: "mov", mime: MIME.mov };
    if (ext === "m4a" || ascii(8, "M4A ")) return { ext: "m4a", mime: MIME.m4a };
    return { ext: "mp4", mime: MIME.mp4 };
  }
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3) && ext === "webm") return { ext: "webm", mime: MIME.webm };
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return { ext: "wav", mime: MIME.wav };
  if (ext === "mp3" && (ascii(0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))
    return { ext: "mp3", mime: MIME.mp3 };
  if (ext === "csv" || ext === "txt" || ext === "md" || ext === "json") {
    if (bytes.includes(0)) return null;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 65_536));
      if (/<(html|script|svg|iframe)/i.test(text)) return null;
      return { ext, mime: MIME[ext] };
    } catch {
      return null;
    }
  }
  return null;
}

/** A workspace's own Documents path: files it uploaded or exported, never another workspace's. */
const OWN_FILE = (workspaceId: string) =>
  new RegExp(`^${workspaceId}/(files|exports)/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`);

type Row = {
  name: string;
  bytes: string;
  at: Date;
  display_name: string | null;
  content_type: string | null;
  source: string;
  folder: string | null;
  added_by: string | null;
  added_by_name: string | null;
};

function toDocument(r: Row): WorkspaceDocument {
  const ext = extOf(r.name);
  const fallback =
    r.source === "record" ? `${kindOf(r.name) === "image" ? "Picture" : "File"}.${ext}` : `File.${ext}`;
  const displayName = r.display_name ?? fallback;
  return {
    name: r.name,
    displayName,
    contentType: r.content_type ?? MIME[ext] ?? "application/octet-stream",
    kind: kindOf(r.name),
    bytes: Number(r.bytes),
    source: (["upload", "export", "record"].includes(r.source) ? r.source : "record") as DocumentSource,
    folder: r.folder,
    addedBy: r.added_by,
    addedByName: r.added_by_name,
    at: r.at.toISOString(),
    url: `/api/files/${r.name}?name=${encodeURIComponent(displayName)}`,
  };
}

/** Every file the workspace keeps, newest first, and how much of the workspace's storage they take. */
export async function listDocuments(
  workspaceId: string,
): Promise<{ documents: WorkspaceDocument[]; usage: DocumentsUsage }> {
  const { rows } = await sql<Row>`
    select name, bytes, at, display_name, content_type, source, folder, added_by, added_by_name
    from file_upload where workspace_id = ${workspaceId} order by at desc limit 5000`.execute(db);
  const documents = rows.map(toDocument);
  const workspaceBytes = documents.reduce((n, d) => n + d.bytes, 0);
  return { documents, usage: { workspaceBytes, limitBytes: WORKSPACE_STORAGE_BYTES } };
}

export type Adder = { id: string; name: string };

async function catalog(
  workspaceId: string,
  name: string,
  bytes: number,
  details: {
    displayName: string;
    contentType: string;
    source: DocumentSource;
    folder?: string | null;
    by: Adder;
  },
): Promise<WorkspaceDocument> {
  await recordUpload(workspaceId, name, bytes, details);
  return toDocument({
    name,
    bytes: String(bytes),
    at: new Date(),
    display_name: details.displayName,
    content_type: details.contentType,
    source: details.source,
    folder: details.folder ?? null,
    added_by: details.by.id,
    added_by_name: details.by.name,
  });
}

const cleanFolder = (folder: string | null | undefined) => {
  const f = folder?.trim().replace(/\s+/g, " ").slice(0, 60);
  return f ? f : null;
};

/**
 * Stores a file uploaded or exported to Documents (through the app, up to DIRECT_UPLOAD_BYTES) under the workspace's
 * files/ or exports/ folder. Null when it isn't a type Documents takes; throws StorageFullError when the workspace
 * has no room.
 */
export async function addDocument(
  workspaceId: string,
  bytes: Uint8Array,
  filename: string,
  options: { source: "upload" | "export"; folder?: string | null; by: Adder },
): Promise<WorkspaceDocument | null> {
  const type = documentFileType(bytes, filename);
  if (!type) return null;
  await assertStorageRoom(workspaceId, bytes.length);
  const name = `${workspaceId}/${options.source === "export" ? "exports" : "files"}/${randomUUID()}.${type.ext}`;
  await uploadsBucket()
    .file(name)
    .save(Buffer.from(bytes), {
      contentType: type.mime,
      resumable: false,
      metadata: { cacheControl: "private" },
    });
  return catalog(workspaceId, name, bytes.length, {
    displayName: cleanFileName(filename, `File.${type.ext}`),
    contentType: type.mime,
    source: options.source,
    folder: cleanFolder(options.folder),
    by: options.by,
  });
}

/**
 * Starts a big upload (a video) that the browser sends straight to storage: checks the name and the room in the
 * workspace, then opens a resumable upload for this origin only. The file isn't listed until finishLargeUpload has
 * checked what actually arrived.
 */
export async function startLargeUpload(
  workspaceId: string,
  filename: string,
  size: number,
  origin: string,
): Promise<{ ok: true; name: string; uploadUrl: string } | { ok: false; message: string }> {
  const ext = extOf(filename);
  if (!MIME[ext] && !["png", "jpg", "gif", "webp"].includes(ext))
    return {
      ok: false,
      message: "Documents takes PDFs, Office files, CSV, text, pictures, videos and audio.",
    };
  if (size > MAX_DOCUMENT_FILE_BYTES) return { ok: false, message: "Files can be up to 500 MB." };
  await assertStorageRoom(workspaceId, size);
  const name = `${workspaceId}/files/${randomUUID()}.${ext}`;
  const [uploadUrl] = await uploadsBucket()
    .file(name)
    .createResumableUpload({
      origin,
      metadata: {
        contentType: MIME[ext] ?? `image/${ext === "jpg" ? "jpeg" : ext}`,
        cacheControl: "private",
      },
    });
  return { ok: true, name, uploadUrl };
}

/**
 * Lists a big upload once it has arrived: what's in storage must be a type Documents takes, as big as its name says
 * it is and still fit on the plan; anything else is deleted.
 */
export async function finishLargeUpload(
  workspaceId: string,
  name: string,
  filename: string,
  options: { folder?: string | null; by: Adder },
): Promise<{ ok: true; document: WorkspaceDocument } | { ok: false; message: string }> {
  if (!OWN_FILE(workspaceId).test(name)) return { ok: false, message: "That upload isn't this workspace's." };
  const file = uploadsBucket().file(name);
  const [exists] = await file.exists();
  if (!exists) return { ok: false, message: "The upload didn't finish. Try again." };
  const [meta] = await file.getMetadata();
  const size = Number(meta.size ?? 0);
  const [head] = await file.download({ start: 0, end: 65_535 });
  const type = documentFileType(new Uint8Array(head), `x.${extOf(name)}`);
  const drop = async (message: string) => {
    await file.delete().catch(() => {});
    return { ok: false as const, message };
  };
  if (!type || type.ext !== extOf(name)) return drop("That file isn't what its name says. Nothing was kept.");
  if (size > MAX_DOCUMENT_FILE_BYTES) return drop("Files can be up to 500 MB.");
  try {
    await assertStorageRoom(workspaceId, size);
  } catch (error) {
    await file.delete().catch(() => {});
    throw error;
  }
  const document = await catalog(workspaceId, name, size, {
    displayName: cleanFileName(filename, `File.${type.ext}`),
    contentType: type.mime,
    source: "upload",
    folder: cleanFolder(options.folder),
    by: options.by,
  });
  return { ok: true, document };
}

/** Renames a file or moves it to another folder. Files attached to records keep their place on the record. */
export async function updateDocument(
  workspaceId: string,
  name: string,
  patch: { displayName?: string; folder?: string | null },
): Promise<boolean> {
  const { numUpdatedRows } = await db
    .updateTable("file_upload" as never)
    .set({
      ...(patch.displayName !== undefined ? { display_name: cleanFileName(patch.displayName) } : {}),
      ...(patch.folder !== undefined ? { folder: cleanFolder(patch.folder) } : {}),
    } as never)
    .where("workspace_id" as never, "=", workspaceId as never)
    .where("name" as never, "=", name as never)
    .executeTakeFirst();
  return Number(numUpdatedRows) > 0;
}

/**
 * Deletes an uploaded or exported file from storage and from the list. Files attached to records are removed from
 * the record instead, so a record never points at a file that's gone. The bucket keeps deleted files for 7 days.
 */
export async function removeDocument(workspaceId: string, name: string): Promise<boolean> {
  if (!OWN_FILE(workspaceId).test(name)) return false;
  await uploadsBucket()
    .file(name)
    .delete()
    .catch(() => {});
  const { numAffectedRows } =
    await sql`delete from file_upload where workspace_id = ${workspaceId} and name = ${name}`.execute(db);
  return Number(numAffectedRows ?? 0) > 0;
}

/** The uploader and source of a listed file, so the route can check who may change it. */
export async function documentInfo(
  workspaceId: string,
  name: string,
): Promise<{ source: DocumentSource; addedBy: string | null } | null> {
  const { rows } = await sql<{ source: string; added_by: string | null }>`
    select source, added_by from file_upload where workspace_id = ${workspaceId} and name = ${name}`.execute(
    db,
  );
  return rows[0] ? { source: rows[0].source as DocumentSource, addedBy: rows[0].added_by } : null;
}
