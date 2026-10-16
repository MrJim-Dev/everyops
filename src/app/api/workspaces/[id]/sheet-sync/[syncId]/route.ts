import { z } from "zod";
import { managerOf } from "@/server/manager-api";
import { removeSync, runSync } from "@/server/sheet-sync";

type Ctx = RouteContext<"/api/workspaces/[id]/sheet-sync/[syncId]">;

/** Syncs now (owners and admins). */
export async function POST(request: Request, { params }: Ctx) {
  const { id, syncId } = await params;
  const { error } = await managerOf(request, id, true);
  if (error) return error;
  if (!z.object({ action: z.literal("run") }).safeParse(await request.json().catch(() => null)).success)
    return Response.json({ ok: false, message: "Say run." }, { status: 400 });
  const result = await runSync(id, syncId);
  return result
    ? Response.json({ ok: true, result })
    : Response.json({ ok: false, message: "No such sync." }, { status: 404 });
}

/** Stops syncing; the records it brought in stay. */
export async function DELETE(request: Request, { params }: Ctx) {
  const { id, syncId } = await params;
  const { error } = await managerOf(request, id, true);
  if (error) return error;
  return (await removeSync(id, syncId))
    ? Response.json({ ok: true })
    : Response.json({ ok: false, message: "No such sync." }, { status: 404 });
}
