/**
 * Documents: every file a workspace keeps, in one place. Shared by the browser and the server; nothing here reads
 * storage. Where each kind of file lives in the uploads bucket (one folder per workspace):
 *
 *   <workspace>/files/<uuid>.<ext>     uploaded in Documents (documents, pictures, videos, audio)
 *   <workspace>/exports/<uuid>.<ext>   exports kept from tables and Settings (CSV, Excel, JSON)
 *   <workspace>/docs/<uuid>.<ext>      file fields on records (receipts, contracts)
 *   <workspace>/<uuid>.<ext>           pictures on records and pages (public by their random name: QR codes)
 *   ai/<account>/<uuid>.<ext>          files attached to Ask EveryOps, deleted after 90 days
 */
export type DocumentSource = "upload" | "export" | "record";
export type DocumentKind = "document" | "spreadsheet" | "image" | "video" | "audio" | "data";

export type WorkspaceDocument = {
  /** Its path in the bucket, and its id. */
  name: string;
  /** The file's own name, as it was uploaded or exported ("October bookings.csv"). */
  displayName: string;
  contentType: string;
  kind: DocumentKind;
  bytes: number;
  source: DocumentSource;
  folder: string | null;
  addedBy: string | null;
  addedByName: string | null;
  at: string;
  /** Where the browser reads it. */
  url: string;
};

export type DocumentsUsage = {
  /** What this workspace's files take up. */
  workspaceBytes: number;
  /** The workspace's storage limit (WORKSPACE_STORAGE_MB). */
  limitBytes: number;
};

/** Files up to this size go through the app; bigger ones (videos) go straight to storage in a resumable upload. */
export const DIRECT_UPLOAD_BYTES = 25_000_000;
/** The biggest single file Documents takes. */
export const MAX_DOCUMENT_FILE_BYTES = 500_000_000;

const EXT_KIND: Record<string, DocumentKind> = {
  pdf: "document",
  docx: "document",
  pptx: "document",
  txt: "document",
  md: "document",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  json: "data",
  png: "image",
  jpg: "image",
  gif: "image",
  webp: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
};

/** Extensions Documents takes; anything else (HTML, SVG, programs, archives) is refused. */
export const DOCUMENT_EXTENSIONS = Object.keys(EXT_KIND);

export const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase().replace(/^jpeg$/, "jpg");

export function kindOf(name: string): DocumentKind {
  return EXT_KIND[extOf(name)] ?? "document";
}

/** A name safe to show and to send as a download name: no path, no control characters, at most 120 characters. */
export function cleanFileName(name: string, fallback = "File"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(base)
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

/** "1.4 MB", "820 KB", "2.1 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

/** The filters Documents offers, and which files each one shows. */
export type DocumentFilter = "all" | "documents" | "images" | "videos" | "exports" | "records";
export function matchesFilter(doc: Pick<WorkspaceDocument, "kind" | "source">, filter: DocumentFilter) {
  switch (filter) {
    case "all":
      return true;
    case "documents":
      return doc.kind === "document" || doc.kind === "spreadsheet" || doc.kind === "data";
    case "images":
      return doc.kind === "image";
    case "videos":
      return doc.kind === "video" || doc.kind === "audio";
    case "exports":
      return doc.source === "export";
    case "records":
      return doc.source === "record";
  }
}
