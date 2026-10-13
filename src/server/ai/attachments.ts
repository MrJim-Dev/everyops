import "server-only";
import { randomUUID } from "node:crypto";
import type { Part } from "@google/genai";
import { Storage } from "@google-cloud/storage";
import { ATTACHMENT_ID, type AttachmentKind, type AttachmentRef } from "@/lib/assistant/attachments";

const BUCKET = process.env.UPLOAD_BUCKET ?? "everyops-prod-uploads";
/** Gemini takes inline files up to about 20 MB per request; stay under it with room for the prompt. */
const MAX_INLINE_BYTES = 18_000_000;
const MAX_TEXT_CHARS = 200_000;

let client: Storage | null = null;
const bucket = () => {
  client ??= new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "everyops-prod" });
  return client.bucket(BUCKET);
};

export type FileType = { kind: AttachmentKind; mime: string; ext: string };

const TEXT_TYPES: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  json: "application/json",
};

/**
 * What a file really is, from its first bytes. The name and the browser's claimed type only decide between
 * look-alikes (audio or video in an MP4/WebM box, which text format). SVG, Office files and programs are refused.
 */
export function detectFile(bytes: Uint8Array, name: string, claimed: string): FileType | null {
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  const ascii = (offset: number, text: string) => at(offset, ...[...text].map((c) => c.charCodeAt(0)));
  const audioClaim = claimed.startsWith("audio/");
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { kind: "image", mime: "image/png", ext: "png" };
  if (at(0, 0xff, 0xd8, 0xff)) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (ascii(0, "GIF8")) return { kind: "image", mime: "image/gif", ext: "gif" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { kind: "image", mime: "image/webp", ext: "webp" };
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return { kind: "audio", mime: "audio/wav", ext: "wav" };
  if (ascii(0, "%PDF-")) return { kind: "pdf", mime: "application/pdf", ext: "pdf" };
  if (ascii(0, "OggS")) return { kind: "audio", mime: "audio/ogg", ext: "ogg" };
  if (ascii(0, "fLaC")) return { kind: "audio", mime: "audio/flac", ext: "flac" };
  if (ascii(0, "ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe6) > 0xe0))
    return { kind: "audio", mime: "audio/mpeg", ext: "mp3" };
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3))
    return audioClaim
      ? { kind: "audio", mime: "audio/webm", ext: "webm" }
      : { kind: "video", mime: "video/webm", ext: "webm" };
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (/^(heic|heix|heim|heis|mif1|msf1)$/.test(brand))
      return { kind: "image", mime: "image/heic", ext: "heic" };
    if (brand === "M4A " || audioClaim) return { kind: "audio", mime: "audio/mp4", ext: "m4a" };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  const ext = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const textExt = ext in TEXT_TYPES ? ext : claimed.startsWith("text/") ? "txt" : null;
  if (textExt && readText(bytes) !== null) return { kind: "text", mime: TEXT_TYPES[textExt], ext: textExt };
  return null;
}

function readText(bytes: Uint8Array): string | null {
  if (!bytes.length || bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const safeName = (name: string) =>
  name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters from file names
    .replace(/[\u0000-\u001f\\/]/g, "")
    .trim()
    .slice(0, 120) || "file";

/** Each account's files live in their own folder; anything that isn't a Better Auth id never reaches a path. */
const ownerFolder = (userId: string) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(userId)) throw new Error("Unexpected account id");
  return `ai/${userId}`;
};

/** Stores an attachment under the uploader's account and returns the reference messages carry. */
export async function saveAttachment(
  userId: string,
  bytes: Uint8Array,
  name: string,
  claimed: string,
): Promise<AttachmentRef | null> {
  const type = detectFile(bytes, name, claimed);
  if (!type) return null;
  const id = `${randomUUID()}.${type.ext}`;
  const original = safeName(name);
  await bucket()
    .file(`${ownerFolder(userId)}/${id}`)
    .save(Buffer.from(bytes), {
      contentType: type.mime,
      resumable: false,
      metadata: { cacheControl: "private", metadata: { name: original, kind: type.kind } },
    });
  return { id, name: original, mime: type.mime, kind: type.kind, size: bytes.byteLength };
}

/** Reads one of the account's own attachments. Another account's files can't be named: the folder is the account. */
export async function readAttachment(
  userId: string,
  id: string,
): Promise<{ bytes: Buffer; mime: string; kind: AttachmentKind } | null> {
  if (!ATTACHMENT_ID.test(id)) return null;
  try {
    const file = bucket().file(`${ownerFolder(userId)}/${id}`);
    const [[bytes], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
    const kind = (meta.metadata?.kind as AttachmentKind | undefined) ?? "image";
    return { bytes, mime: meta.contentType ?? "application/octet-stream", kind };
  } catch {
    return null;
  }
}

/** Picture types a record's image field can show (the same ones workspace uploads accept). */
const RECORD_PICTURE = /^image\/(png|jpeg|gif|webp)$/;

/**
 * Copies one of the account's attached photos into a workspace's own uploads, so a record can show it like any
 * picture uploaded there. Returns the app path for the image field, or null if the file is gone or isn't a photo
 * a record can show. The caller must have checked that the person can edit the workspace.
 */
export async function copyPhotoToWorkspace(
  userId: string,
  id: string,
  workspaceId: string,
): Promise<string | null> {
  if (!ATTACHMENT_ID.test(id) || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(workspaceId)) return null;
  try {
    const source = bucket().file(`${ownerFolder(userId)}/${id}`);
    const [meta] = await source.getMetadata();
    if (!RECORD_PICTURE.test(meta.contentType ?? "")) return null;
    const name = `${workspaceId}/${randomUUID()}.${id.split(".").pop()}`;
    await source.copy(bucket().file(name), {
      contentType: meta.contentType,
      metadata: { cacheControl: "private" },
    });
    return `/api/files/${name}`;
  } catch {
    return null;
  }
}

/**
 * Gemini parts for a conversation's files, each labelled with its name so the model can refer to it. Files that
 * are gone or would push the request over Gemini's inline limit are listed in a note instead.
 */
export async function attachmentParts(userId: string, refs: AttachmentRef[]): Promise<Part[]> {
  if (!refs.length) return [];
  const files = await Promise.all(refs.map((r) => readAttachment(userId, r.id)));
  const parts: Part[] = [];
  const skipped: string[] = [];
  let budget = MAX_INLINE_BYTES;
  refs.forEach((ref, i) => {
    const file = files[i];
    const label = `Attached file "${ref.name}"`;
    if (!file) {
      skipped.push(`${ref.name} (no longer available)`);
      return;
    }
    if (file.kind === "text") {
      const text = file.bytes.toString("utf8");
      const note = text.length > MAX_TEXT_CHARS ? " (only the start is shown)" : "";
      parts.push({ text: `${label}${note}:\n${text.slice(0, MAX_TEXT_CHARS)}` });
      return;
    }
    if (file.bytes.byteLength > budget) {
      skipped.push(`${ref.name} (too large to read with the other files)`);
      return;
    }
    budget -= file.bytes.byteLength;
    parts.push(
      { text: `${label}:` },
      { inlineData: { mimeType: file.mime, data: file.bytes.toString("base64") } },
    );
  });
  if (skipped.length)
    parts.push({ text: `Files you can't see: ${skipped.join(", ")}. Say so if they matter.` });
  return parts;
}

/** The user turn for Gemini: the text, then the attached files, then any closing instruction. */
export async function promptWithFiles(
  userId: string,
  text: string,
  refs: AttachmentRef[],
  after?: string,
): Promise<string | Part[]> {
  const files = await attachmentParts(userId, refs);
  if (!files.length) return after ? `${text}\n\n${after}` : text;
  return [{ text }, ...files, ...(after ? [{ text: after }] : [])];
}
