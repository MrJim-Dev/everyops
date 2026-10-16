import { z } from "zod";
import { decideAction } from "@/server/connections";
import { managerOf } from "@/server/manager-api";

const body = z.object({ decision: z.enum(["apply", "dismiss"]) });

/** An owner or admin applies (runs now) or dismisses an outside action Ask EveryOps proposed. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/workspaces/[id]/connections/actions/[actionId]">,
) {
  const { id, actionId } = await params;
  const { user, error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !Number(actionId))
    return Response.json({ ok: false, message: "Say apply or dismiss." }, { status: 400 });
  const done = await decideAction(id, Number(actionId), user.id, parsed.data.decision);
  return done.ok
    ? Response.json({ ok: true, action: done.action })
    : Response.json({ ok: false, message: done.message }, { status: done.status });
}
