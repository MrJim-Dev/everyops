import { allowedIn, PERMISSIONS } from "@/lib/api-keys";
import { apiCaller, workspaceAccess } from "@/server/api-auth";
import { accessibleWorkspaces } from "@/server/workspaces";

/** One workspace the key reaches: its name, the caller's role and what the key may do there. 404 outside its scope. */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/workspaces/[id]">) {
  const { caller, error } = await apiCaller(request);
  if (error) return error;
  const { id } = await params;
  const access = await workspaceAccess(caller, id, "records:read");
  if (access.error) return access.error;
  const name = (await accessibleWorkspaces(caller.user.id)).find((w) => w.id === id)?.name ?? id;
  const scope = caller.key ?? { workspaces: null, permissions: [...PERMISSIONS] };
  return Response.json({
    data: { id, name, role: access.role, permissions: [...allowedIn(scope, id, access.role)] },
  });
}
