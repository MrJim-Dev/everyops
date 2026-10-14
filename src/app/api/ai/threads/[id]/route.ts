import { z } from "zod";
import { getThread, saveThread } from "@/server/assistant-threads";
import { apiUser, sameOrigin } from "@/server/session-api";

const MAX_BYTES = 600_000;

const body = z.object({
  workspaceId: z.string().min(1).max(80),
  title: z.string().max(200),
  turns: z
    .array(z.looseObject({ role: z.enum(["user", "assistant"]), text: z.string().max(20_000) }))
    .max(200),
});

export async function GET(request: Request, { params }: RouteContext<"/api/ai/threads/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  const thread = await getThread((await params).id, user.id);
  if (!thread) return Response.json({ ok: false, message: "Conversation not found." }, { status: 404 });
  return Response.json({ ok: true, thread });
}

/** Saves the conversation as it is now (the browser sends it after each turn). */
export async function PUT(request: Request, { params }: RouteContext<"/api/ai/threads/[id]">) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES)
    return Response.json({ ok: false, message: "This conversation is too long to save." }, { status: 413 });
  const parsed = body.safeParse(JSON.parse(raw || "null"));
  if (!parsed.success) return Response.json({ ok: false, message: "Invalid conversation." }, { status: 400 });
  const saved = await saveThread({ id: (await params).id, ...parsed.data }, user.id);
  if (!saved) return Response.json({ ok: false, message: "Conversation not found." }, { status: 404 });
  return Response.json({ ok: true });
}
