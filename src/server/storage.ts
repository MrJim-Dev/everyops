import "server-only";
import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const BUCKET = process.env.UPLOAD_BUCKET ?? "everyops-prod-uploads";
export const MAX_UPLOAD_BYTES = 5_000_000;

let client: Storage | null = null;
const bucket = () => {
  client ??= new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "everyops-prod" });
  return client.bucket(BUCKET);
};

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
export async function saveImage(workspaceId: string, bytes: Uint8Array): Promise<string | null> {
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
