import { parseFilters } from "@/lib/api/params";
import { badRequest, restRoute } from "@/server/rest";

/**
 * Exact count, sum, avg, min or max over one record type: ?type=bookings&metric=sum&field=total_amount, optionally
 * filter=…, groupBy=FIELD, or dateField=FIELD&bucket=day|week|month.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/workspaces/[id]/aggregate">) {
  const { id } = await params;
  const p = new URL(request.url).searchParams;
  const type = p.get("type");
  const metric = p.get("metric") || "count";
  if (!type) return badRequest("Say which record type: ?type=<record type id>.");
  if (!["count", "sum", "avg", "min", "max"].includes(metric))
    return badRequest("metric is one of count, sum, avg, min, max.");
  const filters = parseFilters(p);
  if (typeof filters === "string") return badRequest(filters);
  const optional = {
    fieldId: p.get("field"),
    groupBy: p.get("groupBy"),
    dateFieldId: p.get("dateField"),
    bucket: p.get("bucket"),
  };
  return restRoute(request, id, async (call) =>
    Response.json({
      data: await call("aggregate", {
        entityId: type,
        metric,
        filters,
        ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v)),
      }),
    }),
  );
}
