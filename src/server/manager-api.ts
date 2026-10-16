import "server-only";
import { canManage } from "@/lib/store/workspace-model";
import { apiUser, sameOrigin } from "./session-api";
import { roleIn } from "./workspaces";

/** The signed-in owner or admin of a workspace, or the error to answer with (writes also check the origin). */
export async function managerOf(request: Request, workspaceId: string, write = false) {
  if (write && !sameOrigin(request))
    return {
      user: null,
      error: Response.json({ ok: false, message: "Bad origin." }, { status: 403 }),
    } as const;
  const { user, error } = await apiUser(request);
  if (error) return { user: null, error } as const;
  const access = await roleIn(workspaceId, user.id);
  if (!access)
    return {
      user: null,
      error: Response.json({ ok: false, message: "Workspace not found." }, { status: 404 }),
    } as const;
  if (!canManage(access.role))
    return {
      user: null,
      error: Response.json({ ok: false, message: "Owners and admins only." }, { status: 403 }),
    } as const;
  return { user, error: null } as const;
}
