import { z } from "zod";
import { jsonResponse } from "@/server/json-response";
import { apiUser } from "@/server/session-api";
import { MAX_ROWS_PAGE, viewRows } from "@/server/view-rows";

const sortSchema = z
  .array(z.object({ fieldId: z.string().min(1).max(200), dir: z.enum(["asc", "desc"]) }))
  .max(5);

/**
 * A page of a table, worked out on the server: ?offset=&limit= (up to 500), &q= the search, &sort= JSON
 * [{fieldId, dir}], &group= a field id. Used by tables of large record types (src/lib/engine/window.ts).
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/workspaces/[id]/views/[viewId]/rows">,
) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id, viewId } = await params;
  const p = new URL(request.url).searchParams;
  let sort: z.infer<typeof sortSchema> | undefined;
  try {
    sort = p.get("sort") ? sortSchema.parse(JSON.parse(p.get("sort") ?? "")) : undefined;
  } catch {
    return Response.json(
      { ok: false, message: 'sort must be JSON like [{"fieldId":"date","dir":"desc"}].' },
      { status: 400 },
    );
  }
  const page = await viewRows(id, user.id, viewId, {
    offset: Math.max(0, Math.trunc(Number(p.get("offset")) || 0)),
    limit: Math.min(MAX_ROWS_PAGE, Math.max(1, Math.trunc(Number(p.get("limit")) || 100))),
    query: (p.get("q") ?? "").slice(0, 200),
    sort,
    groupBy: p.get("group") || undefined,
  });
  if (!page) return Response.json({ ok: false, message: "Table not found." }, { status: 404 });
  return jsonResponse(request, { ok: true, ...page });
}
