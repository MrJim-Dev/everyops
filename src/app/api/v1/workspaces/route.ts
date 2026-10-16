import { allowedIn, PERMISSIONS } from "@/lib/api-keys";
import { apiCaller } from "@/server/api-auth";
import { accessibleWorkspaces } from "@/server/workspaces";

/**
 * The workspaces this key (or session) reaches, each with the caller's role there and what the key may do in it.
 * The first endpoint of the public API: a quick way to check a key works.
 */
export async function GET(request: Request) {
  const { caller, error } = await apiCaller(request);
  if (error) return error;
  const scope = caller.key ?? { workspaces: null, permissions: [...PERMISSIONS] };
  const data = (await accessibleWorkspaces(caller.user.id))
    .map((w) => ({ id: w.id, name: w.name, role: w.role, permissions: [...allowedIn(scope, w.id, w.role)] }))
    .filter((w) => w.permissions.length);
  return Response.json({
    data,
    ...(caller.key ? { key: { id: caller.key.id, name: caller.key.name } } : {}),
  });
}
