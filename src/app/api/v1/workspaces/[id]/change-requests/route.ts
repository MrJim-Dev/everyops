import { badRequest, jsonBody, restRoute } from "@/server/rest";

/**
 * Leaves a design change request ({ "request": "Add a deposit field to bookings" }) for the workspace's owners and
 * admins, who review it under History. Nothing about the workspace changes until they apply it.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/workspaces/[id]/change-requests">,
) {
  const { id } = await params;
  const body = await jsonBody(request);
  if (typeof body?.request !== "string" || !body.request.trim())
    return badRequest('Send { "request": "What should change, and why" }.');
  return restRoute(request, id, async (call) => {
    const { requestId, message } = (await call("propose_change", { request: body.request })) as {
      requestId: number;
      message: string;
    };
    return Response.json({ data: { requestId, message } }, { status: 201 });
  });
}
