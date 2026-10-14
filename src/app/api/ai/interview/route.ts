import { z } from "zod";
import { attachmentRef } from "@/lib/assistant/attachments";
import { interviewTurn } from "@/server/ai/interview";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser, sameOrigin } from "@/server/session-api";

const body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(4000),
        attachments: z.array(attachmentRef).max(5).optional(),
      }),
    )
    .min(1)
    .max(40)
    .refine((m) => m.reduce((n, t) => n + (t.attachments?.length ?? 0), 0) <= 12, "Too many files"),
});

export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Send a message first." }, { status: 400 });
  const limit = await takeAiToken(user.id);
  if (!limit.ok)
    return Response.json(
      { ok: false, message: "That's a lot of messages. Wait a few minutes and try again." },
      { status: 429 },
    );
  const result = await interviewTurn(parsed.data.messages, user.id);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
