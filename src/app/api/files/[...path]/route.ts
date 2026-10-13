import { readImage } from "@/server/storage";

const NAME = /^[a-z0-9][a-z0-9-]{1,79}\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

/** Serves an uploaded image. Names are random, so this is public: QR codes appear on public booking pages. */
export async function GET(_request: Request, { params }: RouteContext<"/api/files/[...path]">) {
  const name = (await params).path.join("/");
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
