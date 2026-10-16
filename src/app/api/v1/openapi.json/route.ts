import { openapi } from "@/lib/api/openapi";

/** The API's OpenAPI 3.1 description; public so tools and code generators can read it. */
export function GET() {
  return Response.json(openapi, {
    headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
