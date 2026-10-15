import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { byteRange } from "@/lib/byte-range";

/** Public files too large for Cloud Run's 32 MiB response limit; next.config.ts rewrites their paths here. */
const FILES: Record<string, string> = { "demo.mp4": "video/mp4" };

async function serve(request: Request, name: string, withBody: boolean) {
  const mime = FILES[name];
  if (!mime) return new Response("Not found", { status: 404 });
  const file = path.join(process.cwd(), "public", name);
  const size = (await stat(file)).size;
  const headers = new Headers({
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=3600",
  });
  const range = byteRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(withBody ? stream(createReadStream(file, range)) : null, { status: 206, headers });
  }
  // The whole file goes out streamed (no content-length), which Cloud Run allows past 32 MiB.
  return new Response(withBody ? stream(createReadStream(file)) : null, { status: 200, headers });
}

function stream(file: ReturnType<typeof createReadStream>) {
  return Readable.toWeb(file) as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, { params }: RouteContext<"/api/media/[name]">) {
  return serve(request, (await params).name, true);
}

export async function HEAD(request: Request, { params }: RouteContext<"/api/media/[name]">) {
  return serve(request, (await params).name, false);
}
