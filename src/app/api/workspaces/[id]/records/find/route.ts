import { findRecords, MAX_FIND } from "@/server/find-records";
import { jsonResponse } from "@/server/json-response";
import { apiUser } from "@/server/session-api";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Records of one type from the server, for views of a windowed record type: ?entityId= and any of &field=&equals=
 * (a lane, a parent), &dateField=&from=&to= or &before= (days, YYYY-MM-DD), &offset=&limit= (up to 1,000).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/records/find">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  const p = new URL(request.url).searchParams;
  const day = (k: string) => {
    const v = p.get(k);
    return v && DAY.test(v) ? v : undefined;
  };
  const found = await findRecords(id, user.id, {
    entityId: p.get("entityId") ?? "",
    field: p.get("field") || undefined,
    equals: p.get("equals") ?? undefined,
    dateField: p.get("dateField") || undefined,
    from: day("from"),
    to: day("to"),
    before: day("before"),
    offset: Math.max(0, Math.trunc(Number(p.get("offset")) || 0)),
    limit: Math.min(MAX_FIND, Math.max(1, Math.trunc(Number(p.get("limit")) || 200))),
  });
  if (!found) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  return jsonResponse(request, { ok: true, ...found });
}
