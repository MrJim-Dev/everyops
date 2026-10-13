"use client";

/** Longest edge after shrinking. Plenty for Gemini to read a menu or receipt, and for a QR code to scan. */
export const MAX_EDGE = 2048;
/** Photos already this small and within MAX_EDGE are sent untouched. */
const KEEP_BYTES = 1_500_000;
/** Biggest photo we'll try to shrink; anything larger is refused before it's read into memory. */
export const MAX_SOURCE_BYTES = 40_000_000;

export const isHeic = (file: File) => /^image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);

const renamed = (name: string, ext: string) => `${name.replace(/\.[a-z0-9]+$/i, "") || "photo"}.${ext}`;

async function decode(file: File): Promise<ImageBitmap | null> {
  const native = await createImageBitmap(file).catch(() => null);
  if (native || !isHeic(file)) return native;
  // Chrome, Edge and Firefox can't read iPhone photos (HEIC); decode them with libheif, loaded only when needed.
  try {
    const { heicTo } = await import("heic-to");
    return await heicTo({ blob: file, type: "bitmap" });
  } catch {
    return null;
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Gets a photo ready to upload: iPhone HEIC photos become JPEG so every browser can show them, and large
 * photos are scaled down to MAX_EDGE (a 6 MB phone photo becomes a few hundred KB). GIFs, small images
 * and anything that isn't a decodable image are returned as they are.
 */
export async function prepareImage(file: File): Promise<File> {
  const heic = isHeic(file);
  if (
    (!file.type.startsWith("image/") && !heic) ||
    file.type === "image/gif" ||
    file.type === "image/svg+xml"
  )
    return file;
  const bitmap = await decode(file);
  if (!bitmap) return file;
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (!heic && scale === 1 && file.size <= KEEP_BYTES) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // PNGs may be screenshots or logos with transparency: WebP keeps both sharp. Photos become JPEG.
    const png = file.type === "image/png";
    const blob = await encode(canvas, png ? "image/webp" : "image/jpeg", png ? 0.92 : 0.85);
    if (!blob) return file;
    if (!heic && blob.size >= file.size) return file;
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    return new File([blob], renamed(file.name, ext), { type: blob.type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
