import "server-only";
import { gzipSync } from "node:zlib";

/**
 * A JSON response, gzipped when the browser accepts it and it's worth it. Next compresses pages but not route
 * handlers, and a workspace's records are the biggest thing the app sends (about 3.7 MB per 10,000 bookings as
 * plain JSON, roughly a tenth gzipped); Cloud Run refuses responses over 32 MiB, so this also keeps large workspaces
 * opening.
 */
export function jsonResponse(request: Request, data: unknown, init: ResponseInit = {}): Response {
  const body = JSON.stringify(data);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.append("vary", "accept-encoding");
  const accepts = /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
  if (!accepts || body.length < 1024) return new Response(body, { ...init, headers });
  headers.set("content-encoding", "gzip");
  return new Response(new Uint8Array(gzipSync(body, { level: 6 })), { ...init, headers });
}
