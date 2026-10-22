/**
 * Email, phone, link and file values: plain strings, checked the same way in the app, on public forms and in the
 * engine. A file value is the app path of an upload in the workspace's documents, with its original name after
 * ?name= so it downloads as "Receipt Oct.pdf" rather than a random id.
 */

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
const FILE =
  /^\/api\/files\/[a-z0-9][a-z0-9-]{1,79}\/docs\/[0-9a-f-]{36}\.([a-z0-9]{2,4})(?:\?name=([^&#]{1,240}))?$/;

/** Kinds of file a file field takes, by extension. Checked again by their bytes when uploaded. */
export const FILE_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "csv",
  "txt",
  "png",
  "jpg",
  "gif",
  "webp",
] as const;
export const FILE_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp";

export const isEmail = (value: string) => EMAIL.test(value.trim());

/** 7 to 15 digits, with an optional leading + and the usual separators: 0917 555 0123, +63 (2) 8123-4567. */
export function isPhone(value: string) {
  const v = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/** A web address. Bare domains ("courthouse.ph/book") get https:// so they open. */
export function normalizeUrl(value: string): string | undefined {
  const v = value.trim();
  if (!v || /\s/.test(v)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export const telHref = (value: string) => `tel:${value.replace(/[^\d+]/g, "")}`;

export function isFilePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = FILE.exec(value);
  return !!m && (FILE_EXTENSIONS as readonly string[]).includes(m[1]);
}

/** The name a drawn signature is stored with, so the server can tell it from a photo on the same form. */
export const SIGNATURE_FILE = "Signature.png";
/** Previews (nothing is saved) keep a signature in the page as a PNG data URL, at most this long. */
const PREVIEW_SIGNATURE = /^data:image\/png;base64,[A-Za-z0-9+/=]{100,400000}$/;

/** A signature value: a PNG in the workspace's documents, or (in previews only) a PNG kept in the page. */
export function isSignaturePath(value: unknown, { preview = false } = {}): value is string {
  if (typeof value !== "string") return false;
  if (preview && PREVIEW_SIGNATURE.test(value)) return true;
  return FILE.exec(value)?.[1] === "png";
}

/** The name a file was uploaded with, or a plain one from its kind ("File.pdf"). */
export function fileName(value: string): string {
  const m = FILE.exec(value);
  if (!m) return "File";
  if (m[2])
    try {
      return decodeURIComponent(m[2]);
    } catch {
      return m[2];
    }
  return `File.${m[1]}`;
}

/** A display name for a link: its host and path without the scheme ("courthouse.ph/book"). */
export function urlLabel(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
