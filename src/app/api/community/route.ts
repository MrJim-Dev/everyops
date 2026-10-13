import { z } from "zod";
import { DEMO_LOCKED_MESSAGE, isDemoEmail } from "@/lib/auth/demo";
import { listCommunity, publishSystem } from "@/server/community";
import { apiUser, sameOrigin } from "@/server/session-api";
import { roleIn } from "@/server/workspaces";

/** Public: every community system, official templates included. */
export async function GET() {
  return Response.json({ ok: true, systems: await listCommunity() });
}

export const publishBody = z.object({
  workspaceId: z.string(),
  name: z.string().trim().min(2).max(60),
  summary: z.string().trim().min(10).max(200),
  category: z.enum(["booking", "finance", "social", "hris", "pos"]),
  license: z.enum(["MIT", "Apache-2.0"]),
  icon: z.string(),
  includes: z.array(z.string()).max(6),
  blueprint: z.object({ version: z.number(), workspaceName: z.string() }).passthrough(),
});

export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  if (isDemoEmail(user.email))
    return Response.json({ ok: false, message: DEMO_LOCKED_MESSAGE }, { status: 403 });
  const parsed = publishBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "Check the name and summary." }, { status: 400 });
  const access = await roleIn(parsed.data.workspaceId, user.id);
  if (access?.role !== "owner" && access?.role !== "admin")
    return Response.json({ ok: false, message: "Only owners and admins can publish." }, { status: 403 });
  const { workspaceId, ...doc } = parsed.data;
  const system = await publishSystem(user.id, workspaceId, { ...doc, author: user.name } as never);
  return Response.json({ ok: true, system });
}
