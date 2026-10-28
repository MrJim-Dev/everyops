import { Readable } from "node:stream";
import { byteRange } from "@/lib/byte-range";
import { DOCUMENT_EXTENSIONS, kindOf } from "@/lib/documents";
import { apiUser } from "@/server/session-api";
import { readDocument, readImage, uploadsBucket } from "@/server/storage";
import { roleIn } from "@/server/workspaces";

const NAME = /^[a-z0-9][a-z0-9-]{1,79}\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;
const DOC = /^([a-z0-9][a-z0-9-]{1,79})\/docs\/[0-9a-f-]{36}\.(pdf|docx|xlsx|pptx|csv|txt|png|jpg|gif|webp)$/;
/** Files uploaded or exported in Documents (src/lib/documents.ts). */
const KEPT = new RegExp(
  `^([a-z0-9][a-z0-9-]{1,79})/(files|exports)/[0-9a-f-]{36}\\.(${DOCUMENT_EXTENSIONS.join("|")})$`,
);

const downloadName = (given: string) => {
  const safe = given.replace(/["\\\r\n]/g, "").slice(0, 120);
  return `filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
};

/**
 * A Documents file for its team, streamed in byte ranges so a video plays and seeks without loading whole, and
 * past Cloud Run's 32 MiB response limit. Pictures, video and audio show in the page with ?inline=1; everything
 * else downloads.
 */
async function kept(request: Request, name: string, workspaceId: string, ext: string, withBody: boolean) {
  const { user } = await apiUser(request);
  if (!user || !(await roleIn(workspaceId, user.id))) return new Response("Not found", { status: 404 });
  const file = uploadsBucket().file(name);
  const meta = await file
    .getMetadata()
    .then(([m]) => m)
    .catch(() => null);
  if (!meta) return new Response("Not found", { status: 404 });
  const size = Number(meta.size ?? 0);
  const params = new URL(request.url).searchParams;
  const viewable = ["image", "video", "audio"].includes(kindOf(name));
  const headers = new Headers({
    "content-type": meta.contentType ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "content-disposition": `${viewable && params.get("inline") === "1" ? "inline" : "attachment"}; ${downloadName(params.get("name") ?? `File.${ext}`)}`,
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  const range = byteRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const stream = (opts: { start?: number; end?: number }) =>
    Readable.toWeb(file.createReadStream(opts)) as ReadableStream<Uint8Array>;
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(withBody ? stream({ start: range.start, end: range.end }) : null, {
      status: 206,
      headers,
    });
  }
  return new Response(withBody ? stream({}) : null, { status: 200, headers });
}

export async function HEAD(request: Request, { params }: RouteContext<"/api/files/[...path]">) {
  const name = (await params).path.join("/");
  const match = KEPT.exec(name);
  return match ? kept(request, name, match[1], match[3], false) : new Response(null, { status: 404 });
}

/**
 * Serves an upload. Images have random names and are public: QR codes appear on public booking pages. Documents
 * (file fields: receipts, contracts) are only for people on the workspace's team, and always download.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/files/[...path]">) {
  const name = (await params).path.join("/");
  const keptFile = KEPT.exec(name);
  if (keptFile) return kept(request, name, keptFile[1], keptFile[3], true);
  const doc = DOC.exec(name);
  if (doc) {
    const { user } = await apiUser(request);
    if (!user || !(await roleIn(doc[1], user.id))) return new Response("Not found", { status: 404 });
    const file = await readDocument(name);
    if (!file) return new Response("Not found", { status: 404 });
    const given = new URL(request.url).searchParams.get("name") ?? `File.${doc[2]}`;
    const safe = given.replace(/["\\\r\n]/g, "").slice(0, 120);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.mime,
        "content-disposition": `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }
  if (!NAME.test(name)) return new Response("Not found", { status: 404 });
  const image = await readImage(name);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "content-type": image.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
