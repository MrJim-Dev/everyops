import "server-only";
import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { recordUpload } from "./storage-usage";

const BUCKET = process.env.UPLOAD_BUCKET ?? "everyops-prod-uploads";
export const MAX_UPLOAD_BYTES = 5_000_000;
/** Documents (file fields) may be larger than pictures: a scanned contract. */
export const MAX_DOCUMENT_BYTES = 10_000_000;

let client: Storage | null = null;
const bucket = () => {
  client ??= new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "everyops-prod" });
  return client.bucket(BUCKET);
};
/** The uploads bucket, for Documents (src/server/documents.ts); its layout is in src/lib/documents.ts. */
export const uploadsBucket = bucket;

/** Image types we accept, recognised by their first bytes (never by the name or the browser's claim). SVG is refused. */
export function imageType(bytes: Uint8Array): { ext: string; mime: string } | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { ext: "png", mime: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { ext: "jpg", mime: "image/jpeg" };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { ext: "gif", mime: "image/gif" };
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return { ext: "webp", mime: "image/webp" };
  return null;
}

/**
 * Stores an image under the workspace in Cloud Storage and returns the app path that serves it. The name is a
 * random UUID, so a file can only be found by someone who was given its link (a QR code on a public page).
 */
export async function saveImage(
  workspaceId: string,
  bytes: Uint8Array,
  by?: { id: string; name: string },
): Promise<string | null> {
  const type = imageType(bytes);
  if (!type) return null;
  const name = `${workspaceId}/${randomUUID()}.${type.ext}`;
  await bucket()
    .file(name)
    .save(Buffer.from(bytes), {
      contentType: type.mime,
      resumable: false,
      metadata: { cacheControl: "private" },
    });
  await recordUpload(workspaceId, name, bytes.length, { contentType: type.mime, by });
  return `/api/files/${name}`;
}

export async function readImage(name: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const file = bucket().file(name);
  try {
    const [bytes] = await file.download();
    const type = imageType(bytes);
    return type ? { bytes, mime: type.mime } : null;
  } catch {
    return null;
  }
}

const DOC_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/**
 * Documents a file field takes, recognised by their bytes and checked against the name's extension: PDF, Office
 * files (zip containers), plain text and CSV (UTF-8 without NUL bytes), and the same pictures as images. HTML, SVG
 * and anything else are refused.
 */
export function documentType(bytes: Uint8Array, filename: string): { ext: string; mime: string } | null {
  const ext = (filename.split(".").pop() ?? "").toLowerCase().replace("jpeg", "jpg");
  const image = imageType(bytes);
  if (image) return image;
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return { ext: "pdf", mime: DOC_TYPES.pdf };
  if (starts(0x50, 0x4b, 0x03, 0x04) && (ext === "docx" || ext === "xlsx" || ext === "pptx"))
    return { ext, mime: DOC_TYPES[ext] };
  if (ext === "csv" || ext === "txt") {
    if (bytes.includes(0)) return null;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 65_536));
      if (/<(html|script|svg)/i.test(text)) return null;
      return { ext, mime: DOC_TYPES[ext] };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Stores a document under the workspace's docs/ and returns its app path with the original name, which the files
 * route serves only to the workspace's team (as a download).
 */
export async function saveDocument(
  workspaceId: string,
  bytes: Uint8Array,
  filename: string,
  by?: { id: string; name: string },
): Promise<string | null> {
  const type = documentType(bytes, filename);
  if (!type) return null;
  const name = `${workspaceId}/docs/${randomUUID()}.${type.ext}`;
  await bucket()
    .file(name)
    .save(Buffer.from(bytes), {
      contentType: type.mime,
      resumable: false,
      metadata: { cacheControl: "private" },
    });
  const shown =
    Array.from(filename)
      .filter((c) => c.charCodeAt(0) >= 32 && c !== "/" && c !== "\\")
      .join("")
      .trim()
      .slice(0, 120) || `File.${type.ext}`;
  await recordUpload(workspaceId, name, bytes.length, { displayName: shown, contentType: type.mime, by });
  return `/api/files/${name}?name=${encodeURIComponent(shown)}`;
}

export async function readDocument(name: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const ext = name.split(".").pop() ?? "";
  try {
    const [bytes] = await bucket().file(name).download();
    const type = documentType(bytes, `f.${ext}`);
    return type && type.ext === ext ? { bytes, mime: type.mime } : null;
  } catch {
    return null;
  }
}
