import { z } from "zod";
import { managerOf } from "@/server/manager-api";
import { listDeliveries, resend, sendTest } from "@/server/webhooks";

type Ctx = RouteContext<"/api/workspaces/[id]/webhooks/[hookId]/deliveries">;

/** An endpoint's recent deliveries, newest first, with what each sent and how it went. */
export async function GET(request: Request, { params }: Ctx) {
  const { id, hookId } = await params;
  const { error } = await managerOf(request, id);
  if (error) return error;
  return Response.json({ ok: true, deliveries: await listDeliveries(id, hookId) });
}

const body = z.union([
  z.object({ resend: z.number().int().positive() }),
  z.object({ test: z.literal(true) }),
]);

/** { resend: <delivery id> } sends it again with the same event id; { test: true } sends a webhook.test event. */
export async function POST(request: Request, { params }: Ctx) {
  const { id, hookId } = await params;
  const { error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Say what to send." }, { status: 400 });
  const ok =
    "resend" in parsed.data ? await resend(id, hookId, parsed.data.resend) : await sendTest(id, hookId);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ ok: false, message: "Not found." }, { status: 404 });
}
