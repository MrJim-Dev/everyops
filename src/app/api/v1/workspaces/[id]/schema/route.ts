import { restRoute } from "@/server/rest";

/** The workspace's record types, fields (ids, types, choices, links), pages and automations. */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/workspaces/[id]/schema">) {
  const { id } = await params;
  return restRoute(request, id, async (call) =>
    Response.json({ data: await call("describe_workspace", {}) }),
  );
}
