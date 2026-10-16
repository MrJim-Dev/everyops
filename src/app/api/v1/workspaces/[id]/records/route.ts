import { cursor, parseFilters } from "@/lib/api/params";
import { badRequest, jsonBody, restRoute, withRevs, writeResponse } from "@/server/rest";

/**
 * Records of one type (?type=bookings), newest first unless sorted (sort=FIELD or -FIELD), filtered with
 * filter=FIELD:OP:VALUE, searched with q, 25 a page (limit up to 50); meta.nextCursor fetches the next page.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/workspaces/[id]/records">) {
  const { id } = await params;
  const p = new URL(request.url).searchParams;
  const type = p.get("type");
  if (!type) return badRequest("Say which record type: ?type=<record type id>.");
  const filters = parseFilters(p);
  if (typeof filters === "string") return badRequest(filters);
  const offset = cursor.decode(p.get("cursor"));
  if (offset === null)
    return badRequest("That cursor isn't valid. Use meta.nextCursor from the previous page.");
  const limit = Math.min(Math.max(Math.trunc(Number(p.get("limit"))) || 25, 1), 50);
  const sort = p.get("sort") || "-createdAt";
  return restRoute(request, id, async (call) => {
    const page = (await call("search_records", {
      entityId: type,
      ...(p.get("q") ? { query: p.get("q") } : {}),
      filters,
      sortBy: sort.replace(/^-/, ""),
      sortDir: sort.startsWith("-") ? "desc" : "asc",
      limit,
      offset,
    })) as { total: number; shown: number; records: { id: string }[] };
    const seen = offset + page.shown;
    return Response.json({
      data: await withRevs(id, page.records),
      meta: { total: page.total, nextCursor: page.shown && seen < page.total ? cursor.encode(seen) : null },
    });
  });
}

/** Creates a record: { "type": "bookings", "values": { … } }. Checked and saved like the app saves it. */
export async function POST(request: Request, { params }: RouteContext<"/api/v1/workspaces/[id]/records">) {
  const { id } = await params;
  const body = await jsonBody(request);
  if (!body || typeof body.type !== "string" || !body.values || typeof body.values !== "object")
    return badRequest('Send { "type": "<record type id>", "values": { "<field>": … } }.');
  return restRoute(request, id, async (call) =>
    writeResponse(await call("create_record", { entityId: body.type, values: body.values }), 201),
  );
}
