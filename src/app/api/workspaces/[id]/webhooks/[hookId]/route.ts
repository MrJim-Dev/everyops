import { z } from "zod";
import { urlProblem, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { managerOf } from "@/server/manager-api";
import { deleteEndpoint, endpointSecret, updateEndpoint } from "@/server/webhooks";

type Ctx = RouteContext<"/api/workspaces/[id]/webhooks/[hookId]">;

/** The endpoint's signing secret, for owners and admins setting up the receiver. */
export async function GET(request: Request, { params }: Ctx) {
  const { id, hookId } = await params;
  const { error } = await managerOf(request, id);
  if (error) return error;
  const secret = await endpointSecret(id, hookId);
  return secret
    ? Response.json({ ok: true, secret })
    : Response.json({ ok: false, message: "No such endpoint." }, { status: 404 });
}

const patchBody = z.object({
  url: z.string().trim().min(1).max(2000).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  entityIds: z.array(z.string().min(1).max(80)).max(100).nullable().optional(),
  enabled: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

/** Turns an endpoint on or off, changes what it receives, or rotates its secret (the new one is in the answer). */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id, hookId } = await params;
  const { error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = patchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "That change isn't valid." }, { status: 400 });
  const problem = parsed.data.url ? urlProblem(parsed.data.url) : null;
  if (problem) return Response.json({ ok: false, message: problem }, { status: 400 });
  const done = await updateEndpoint(id, hookId, parsed.data);
  return done.found
    ? Response.json({ ok: true, ...(done.secret ? { secret: done.secret } : {}) })
    : Response.json({ ok: false, message: "No such endpoint." }, { status: 404 });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { id, hookId } = await params;
  const { error } = await managerOf(request, id, true);
  if (error) return error;
  return (await deleteEndpoint(id, hookId))
    ? Response.json({ ok: true })
    : Response.json({ ok: false, message: "No such endpoint." }, { status: 404 });
}
