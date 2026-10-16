import { handleMcp } from "@/server/mcp/server";

/** One workspace's MCP endpoint: its tools can't reach any other workspace, whatever the key allows. */
async function route(request: Request, { params }: RouteContext<"/mcp/w/[workspace]">) {
  return handleMcp(request, { kind: "workspace", workspaceId: (await params).workspace });
}
export const POST = route;
export const GET = route;
export const DELETE = route;
