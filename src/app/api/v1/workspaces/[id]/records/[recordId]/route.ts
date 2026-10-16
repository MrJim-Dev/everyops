import { revOf } from "@/lib/api/params";
import { badRequest, jsonBody, restRoute, writeResponse } from "@/server/rest";

type Ctx = RouteContext<"/api/v1/workspaces/[id]/records/[recordId]">;

/** One record with every field, its linked records and its rev. */
export async function GET(request: Request, { params }: Ctx) {
  const { id, recordId } = await params;
  return restRoute(request, id, async (call) => {
    const { record, type, linked, rev } = (await call("get_record", { id: recordId })) as {
      record: Record<string, unknown>;
      type: string;
      linked: Record<string, unknown>;
      rev: number | null;
    };
    return Response.json({ data: { ...record, rev, linked }, meta: { type } });
  });
}

/**
 * Changes some fields: { "values": { … }, "rev": 3 } (or If-Match: 3). With a rev that is no longer current nothing
 * is written: 409 with the record as it is now in error.details.current.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id, recordId } = await params;
  const body = await jsonBody(request);
  if (!body?.values || typeof body.values !== "object")
    return badRequest('Send { "values": { "<field>": … } }.');
  const rev = revOf(request, body);
  return restRoute(request, id, async (call) =>
    writeResponse(
      await call("update_record", { id: recordId, values: body.values, ...(rev ? { rev } : {}) }),
    ),
  );
}

/** Deletes a record and its line items (?rev=3 or If-Match: 3 to delete only what you read). */
export async function DELETE(request: Request, { params }: Ctx) {
  const { id, recordId } = await params;
  const rev = revOf(request);
  return restRoute(request, id, async (call) => {
    const result = await call("delete_record", { id: recordId, ...(rev ? { rev } : {}) });
    const response = writeResponse(result);
    return response.status === 200 ? new Response(null, { status: 204 }) : response;
  });
}
