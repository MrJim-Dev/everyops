import { cookies } from "next/headers";
import { canManage } from "@/lib/store/workspace-model";
import { completeConnection, readState } from "@/server/connections";
import { appUrl } from "@/server/mail";
import { apiUser } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

/**
 * Google's redirect after consent. The state must be ours (signed, unexpired, matching the cookie nonce) and the
 * signed-in person must be the one who started and still an owner or admin of the workspace.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = readState(url.searchParams.get("state"));
  const jar = await cookies();
  const nonce = jar.get("eo_connect")?.value;
  jar.delete({ name: "eo_connect", path: "/api/connections" });
  const back = (workspace: string | null, query: string) =>
    Response.redirect(
      appUrl(workspace ? `/w/${workspace}/settings/connections?${query}` : "/workspaces"),
      302,
    );
  if (!state || !nonce || nonce !== state.n) return back(state?.w ?? null, "error=expired");
  const { user, error } = await apiUser(request);
  if (error || user.id !== state.u) return back(state.w, "error=account");
  const access = await roleIn(state.w, user.id);
  if (!access || !canManage(access.role)) return back(state.w, "error=role");
  const code = url.searchParams.get("code");
  if (!code) return back(state.w, `error=${encodeURIComponent(url.searchParams.get("error") ?? "denied")}`);
  try {
    await completeConnection(state, code);
    return back(state.w, `connected=${state.p}`);
  } catch (e) {
    return back(state.w, `error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
