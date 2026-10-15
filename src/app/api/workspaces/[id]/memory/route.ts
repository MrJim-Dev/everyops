import { z } from "zod";
import { MAX_INSTRUCTIONS, MAX_NOTE_CHARS, MAX_NOTES, MEMORY_KINDS } from "@/lib/assistant/memory";
import { apiUser, sameOrigin } from "@/server/session-api";
import { readMemory, saveMemory } from "@/server/workspace-memory";
import { roleIn } from "@/server/workspaces";

/** What Ask EveryOps remembers about this workspace. Everyone on the team can read it. */
export async function GET(request: Request, { params }: RouteContext<"/api/workspaces/[id]/memory">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const { id } = await params;
  if (!(await roleIn(id, user.id)))
    return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  return Response.json({ ok: true, memory: await readMemory(id) });
}

const body = z.object({
  instructions: z.string().max(MAX_INSTRUCTIONS),
  notes: z
    .array(
      z.object({
        id: z.string().max(60).optional(),
        kind: z.enum(MEMORY_KINDS),
        text: z.string().trim().min(1).max(MAX_NOTE_CHARS),
      }),
    )
    .max(MAX_NOTES),
});

/** Owners and admins set the instructions and edit, add or delete notes. */
export async function PUT(request: Request, { params }: RouteContext<"/api/workspaces/[id]/memory">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const access = await roleIn(id, user.id);
  if (!access) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  if (access.role !== "owner" && access.role !== "admin")
    return Response.json(
      { ok: false, message: "Only the owner or an admin can change what the assistant remembers." },
      { status: 403 },
    );
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "Notes are 1 to 300 characters each." }, { status: 400 });
  return Response.json({ ok: true, memory: await saveMemory(id, parsed.data) });
}
