import "server-only";
import { randomUUID } from "node:crypto";
import type { Part } from "@google/genai";
import { Storage } from "@google-cloud/storage";
import { ATTACHMENT_ID, type AttachmentKind, type AttachmentRef } from "@/lib/assistant/attachments";

const BUCKET = process.env.UPLOAD_BUCKET ?? "everyops-prod-uploads";
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

/**
 * Where a stored attachment lives and what it is, without downloading it. Null when it's gone or isn't the
 * account's own.
 */
async function attachmentInfo(
  userId: string,
  id: string,
): Promise<{ uri: string; mime: string; kind: AttachmentKind } | null> {
  if (!ATTACHMENT_ID.test(id)) return null;
  const path = `${ownerFolder(userId)}/${id}`;
  try {
    const [meta] = await bucket().file(path).getMetadata();
    const kind = (meta.metadata?.kind as AttachmentKind | undefined) ?? "image";
    return { uri: `gs://${BUCKET}/${path}`, mime: meta.contentType ?? "application/octet-stream", kind };
  } catch {
    return null;
  }
}

/**
 * Gemini parts for a conversation's files, each labelled with its name so the model can refer to it. Text files
 * (including converted Office files) are sent as text; photos, PDFs, audio and video are passed as Cloud Storage
 * links that Gemini reads directly, so they're never loaded into this server's memory and several large files
 * fit in one request. Files that are gone are listed in a note instead.
 */
export async function attachmentParts(userId: string, refs: AttachmentRef[]): Promise<Part[]> {
  if (!refs.length) return [];
  const files = await Promise.all(
    refs.map(async (r) => {
      const info = await attachmentInfo(userId, r.id);
      if (!info) return null;
      if (info.kind !== "text") return { ...info, text: null };
      const file = await readAttachment(userId, r.id);
      return file ? { ...info, text: file.bytes.toString("utf8") } : null;
    }),
  );
  const parts: Part[] = [];
  const skipped: string[] = [];
  refs.forEach((ref, i) => {
    const file = files[i];
    const label = `Attached file "${ref.name}"`;
    if (!file) {
      skipped.push(`${ref.name} (no longer available)`);
      return;
    }
    if (file.text !== null) {
      const text = file.text;
      const note = text.length > MAX_TEXT_CHARS ? " (only the start is shown)" : "";
      parts.push({ text: `${label}${note}:\n${text.slice(0, MAX_TEXT_CHARS)}` });
      return;
    }
    parts.push({ text: `${label}:` }, { fileData: { fileUri: file.uri, mimeType: file.mime } });
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
