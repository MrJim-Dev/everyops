import { z } from "zod";
import { managerOf } from "@/server/manager-api";
import { apiUser } from "@/server/session-api";
import { createSync, listSyncs } from "@/server/sheet-sync";
import { roleIn } from "@/server/workspaces";

/** The workspace's Google Sheets syncs and how their last run went, for anyone on its team. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/sheet-sync">) {
  const { id } = await params;
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  return Response.json({ ok: true, syncs: await listSyncs(id) });
}

const body = z.object({
  entityId: z.string().min(1).max(80),
  url: z.string().min(1).max(2000),
  mapping: z
    .array(z.object({ header: z.string().min(1).max(200), fieldId: z.string().min(1).max(80) }))
    .min(1)
    .max(200),
  matchFieldId: z.string().min(1).max(80),
  defaults: z.record(z.string(), z.string().max(500)).default({}),
  createLinked: z.boolean().default(true),
});

/** Keeps a record type in sync with a shared Google Sheet (owners and admins); runs it once straight away. */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/sheet-sync">) {
  const { id } = await params;
  const { user, error } = await managerOf(request, id, true);
  if (error) return error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "That sync isn't complete." }, { status: 400 });
  const made = await createSync(id, user.id, parsed.data);
  return made.ok ? Response.json(made) : Response.json(made, { status: 400 });
}
