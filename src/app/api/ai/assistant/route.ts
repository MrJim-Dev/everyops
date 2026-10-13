import { z } from "zod";
import { attachmentRef } from "@/lib/assistant/attachments";
import { blueprintOf, canEdit, canManage } from "@/lib/store/workspace-model";
import { assistantTurn } from "@/server/ai/assistant";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser, sameOrigin } from "@/server/session-api";
import { loadWorkspace } from "@/server/workspaces";

const body = z.object({
  workspaceId: z.string().min(1),
  page: z.string().max(200).default("Workspace"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(4000),
        attachments: z.array(attachmentRef).max(5).optional(),
      }),
    )
    .min(1)
    .max(30)
    .refine((m) => m.reduce((n, t) => n + (t.attachments?.length ?? 0), 0) <= 12, "Too many files"),
});

/** The workspace assistant. It reads the workspace from the database, so it sees what the person can see. */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Ask something first." }, { status: 400 });
  const found = await loadWorkspace(parsed.data.workspaceId, user.id);
  if (!found) return Response.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const limit = takeAiToken(user.id);
  if (!limit.ok)
    return Response.json(
      { ok: false, message: "That's a lot of questions. Wait a few minutes and try again." },
      { status: 429 },
    );
  const result = await assistantTurn({
    blueprint: blueprintOf(found.workspace),
    records: found.workspace.records,
    messages: parsed.data.messages,
    page: parsed.data.page,
    canDesign: canManage(found.role),
    canEditRecords: canEdit(found.role),
    userId: user.id,
  });
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
