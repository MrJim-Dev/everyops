import { z } from "zod";
import { urlProblem, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { managerOf } from "@/server/manager-api";
import { createEndpoint, listEndpoints } from "@/server/webhooks";

/** A workspace's webhook endpoints with their last week of deliveries, for owners and admins. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/webhooks">) {
  const { id } = await params;
  const { error } = await managerOf(request, id);
  if (error) return error;
  return Response.json({ ok: true, endpoints: await listEndpoints(id) });
}

const endpointBody = z.object({
  url: z.string().trim().min(1).max(2000),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  entityIds: z.array(z.string().min(1).max(80)).max(100).nullable().optional(),
});

const MAX_ENDPOINTS = 10;

/** Adds an endpoint; its signing secret is in the answer (and can be revealed again by owners and admins). */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/webhooks">) {
  const { id } = await params;
  const { user, error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = endpointBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { ok: false, message: "Give the endpoint a URL and at least one event." },
      { status: 400 },
    );
  const problem = urlProblem(parsed.data.url);
  if (problem) return Response.json({ ok: false, message: problem }, { status: 400 });
  if ((await listEndpoints(id)).length >= MAX_ENDPOINTS)
    return Response.json(
      { ok: false, message: `A workspace can have up to ${MAX_ENDPOINTS} endpoints.` },
      { status: 400 },
    );
  const made = await createEndpoint(id, user.id, {
    url: parsed.data.url,
    description: parsed.data.description || null,
    events: [...new Set(parsed.data.events)],
    entityIds: parsed.data.entityIds?.length ? [...new Set(parsed.data.entityIds)] : null,
  });
  return Response.json({ ok: true, ...made });
}
