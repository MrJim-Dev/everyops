import "server-only";
import { allowedIn, PERMISSIONS, type Permission, reaches } from "@/lib/api-keys";
import type { Role } from "@/lib/store/workspace-model";
import { takeToken } from "./ai/rate-limit";
import { type VerifiedKey, verifyKey } from "./api-keys";
import { auth } from "./auth";
import { roleIn } from "./workspaces";

/** Requests one key may make per minute, across every instance. */
const PER_MINUTE = Number(process.env.API_KEY_RATE_LIMIT ?? 120);

export type ApiCaller = {
  user: { id: string; name: string; email: string };
  /** A browser session (the app itself) or an API key. */
  via: "session" | "key";
  key: VerifiedKey["key"] | null;
};

const fail = (status: number, code: string, message: string, headers?: HeadersInit) =>
  Response.json({ error: { code, message } }, { status, headers });

const bearer = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? request.headers.get("x-api-key");
};

const ipOf = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;

/**
 * Who is calling a public API route (the REST API, MCP): an API key in "Authorization: Bearer eo_live_…" (or
 * X-API-Key), else the signed-in browser session. Keys are rate limited per key. The app's own routes keep using
 * apiUser, which accepts only the session.
 */
export async function apiCaller(
  request: Request,
): Promise<{ caller: ApiCaller; error: null } | { caller: null; error: Response }> {
  const secret = bearer(request);
  if (secret) {
    const verified = await verifyKey(secret, ipOf(request));
    if (!verified)
      return {
        caller: null,
        error: fail(
          401,
          "invalid_key",
          "This API key isn't valid. It may have been revoked or have expired.",
        ),
      };
    const limit = await takeToken(`apikey:${verified.key.id}`, PER_MINUTE, 60_000);
    if (!limit.ok)
      return {
        caller: null,
        error: fail(429, "rate_limited", "Too many requests for this key. Slow down.", {
          "retry-after": String(limit.retryAfterSeconds),
        }),
      };
    return { caller: { user: verified.user, via: "key", key: verified.key }, error: null };
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return {
      caller: null,
      error: fail(401, "unauthorized", "Send an API key as Authorization: Bearer eo_live_…", {
        "www-authenticate": 'Bearer realm="EveryOps"',
      }),
    };
  const { id, name, email } = session.user;
  return { caller: { user: { id, name, email }, via: "session", key: null }, error: null };
}

/**
 * Whether the caller may do one thing in one workspace. A key is checked against its workspace list and
 * permissions, capped by its owner's current role there; a session only by the role. Answers with the role, or the
 * error to return: 404 when the workspace isn't reachable (so its existence isn't revealed), 403 when it is but the
 * key or role doesn't allow this.
 */
export async function workspaceAccess(
  caller: ApiCaller,
  workspaceId: string,
  need: Permission,
): Promise<{ role: Role; error: null } | { role: null; error: Response }> {
  const found = await roleIn(workspaceId, caller.user.id);
  const role = found?.role ?? null;
  if (!role || (caller.key && !reaches(caller.key, workspaceId)))
    return { role: null, error: fail(404, "not_found", "Workspace not found.") };
  // The signed-in app has every permission; its role still decides.
  const scope = caller.key ?? { workspaces: null, permissions: [...PERMISSIONS] };
  if (!allowedIn(scope, workspaceId, role).has(need))
    return {
      role: null,
      error: fail(
        403,
        "forbidden",
        caller.key && !caller.key.permissions.includes(need)
          ? `This key doesn't have the ${need} permission.`
          : `Your role here (${role}) can't do that.`,
      ),
    };
  return { role, error: null };
}
