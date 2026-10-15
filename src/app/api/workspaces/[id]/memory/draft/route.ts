import { blueprintOf, canManage } from "@/lib/store/workspace-model";
import { draftMemory } from "@/server/ai/memory-draft";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser, sameOrigin } from "@/server/session-api";
import { readMemory } from "@/server/workspace-memory";
import { loadWorkspace } from "@/server/workspaces";

/** Drafts memory notes from the workspace itself. Nothing is saved: the owner picks which to keep. */
export async function POST(request: Request, { params }: RouteContext<"/api/workspaces/[id]/memory/draft">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const found = await loadWorkspace(id, user.id);
  if (!found) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  if (!canManage(found.role))
    return Response.json(
      { ok: false, message: "Only the owner or an admin can edit the memory." },
      { status: 403 },
    );
  const limit = await takeAiToken(user.id);
  if (!limit.ok) return Response.json({ ok: false, message: "Try again in a few minutes." }, { status: 429 });
  try {
    const notes = await draftMemory({
      blueprint: blueprintOf(found.workspace),
      records: found.workspace.records,
      docs: found.workspace.docs,
      memory: await readMemory(id),
      name: found.workspace.name,
      summary: found.workspace.summary,
    });
    return Response.json({ ok: true, notes: notes.map(({ kind, text }) => ({ kind, text })) });
  } catch (e) {
    console.error(JSON.stringify({ event: "memory_draft_failed", message: String(e) }));
    return Response.json({ ok: false, message: "Couldn't draft notes right now." }, { status: 502 });
  }
}
