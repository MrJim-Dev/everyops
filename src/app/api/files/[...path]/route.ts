import { apiUser } from "@/server/session-api";
import { readDocument, readImage } from "@/server/storage";
import { roleIn } from "@/server/workspaces";

const NAME = /^[a-z0-9][a-z0-9-]{1,79}\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;
const DOC = /^([a-z0-9][a-z0-9-]{1,79})\/docs\/[0-9a-f-]{36}\.(pdf|docx|xlsx|pptx|csv|txt|png|jpg|gif|webp)$/;

/**
 * Serves an upload. Images have random names and are public: QR codes appear on public booking pages. Documents
 * (file fields: receipts, contracts) are only for people on the workspace's team, and always download.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/files/[...path]">) {
  const name = (await params).path.join("/");
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
