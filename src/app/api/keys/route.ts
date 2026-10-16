import { z } from "zod";
import { PERMISSIONS } from "@/lib/api-keys";
import { createKey, listKeys } from "@/server/api-keys";
import { apiUser, sameOrigin } from "@/server/session-api";
import { accessibleWorkspaces } from "@/server/workspaces";

/** The signed-in account's API keys (never their secrets). */
export async function GET(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  return Response.json({ ok: true, keys: await listKeys(user.id) });
}

const body = z.object({
  name: z.string().trim().min(1).max(60),
  workspaces: z.array(z.string().min(1).max(80)).min(1).max(100).nullable(),
  permissions: z.array(z.enum(PERMISSIONS)).min(1),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]),
});

/**
 * Makes a key. Its secret is in this answer and nowhere else. Keys are made from the account page only (a session,
 * never another key), and only for workspaces the account can open now.
 */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, message: "Give the key a name and at least one permission." },
      { status: 400 },
    );
  const input = parsed.data;
  if (input.workspaces) {
    const mine = new Set((await accessibleWorkspaces(user.id)).map((w) => w.id));
    if (input.workspaces.some((id) => !mine.has(id)))
      return Response.json({ ok: false, message: "Pick workspaces you can open." }, { status: 400 });
  }
  const made = await createKey(user.id, {
    ...input,
    permissions: [...new Set(input.permissions)],
    workspaces: input.workspaces ? [...new Set(input.workspaces)] : null,
  });
  if (!made.ok) return Response.json(made, { status: 409 });
  return Response.json({ ok: true, key: made.key, secret: made.secret });
}
