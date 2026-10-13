import { z } from "zod";
import { attachmentRef } from "@/lib/assistant/attachments";
import { blueprintPreview } from "@/lib/assistant/preview";
import { designWorkspace } from "@/server/ai/design";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser, sameOrigin } from "@/server/session-api";

const body = z.object({
  brief: z.string().min(20).max(8000),
  workspaceName: z.string().max(80).default(""),
  /** The files from the setup conversation, so real items and prices end up in the workspace. */
  attachments: z.array(attachmentRef).max(12).default([]),
});

export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ ok: false, message: "Tell me a bit more first." }, { status: 400 });
  const limit = await takeAiToken(user.id);
  if (!limit.ok)
    return Response.json({ ok: false, message: "Wait a few minutes and try again." }, { status: 429 });
  const result = await designWorkspace(parsed.data.brief, parsed.data.workspaceName, {
    userId: user.id,
    attachments: parsed.data.attachments,
  });
  if (!result.ok) return Response.json(result, { status: 502 });
  return Response.json({
    ok: true,
    draft: {
      name: result.name,
      summary: result.summary,
      data: result.data,
      preview: blueprintPreview(result.data),
    },
  });
}
