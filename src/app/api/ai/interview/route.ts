import { z } from "zod";
import { attachmentRef } from "@/lib/assistant/attachments";
import { type InterviewPartial, interviewTurn } from "@/server/ai/interview";
import { takeAiToken } from "@/server/ai/rate-limit";
import { enterAiUsage, startAiUsage } from "@/server/ai/usage";
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
  /** The setup checklist so far, so required questions keep being asked until answered. */
  questions: z
    .array(
      z.object({
        id: z.string().max(80),
        question: z.string().max(400),
        required: z.boolean(),
        answer: z.string().max(1000),
      }),
    )
    .max(24)
    .optional(),
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
  const overBudget = await startAiUsage(`account:${user.id}`);
  if (overBudget) return overBudget;
  enterAiUsage(`account:${user.id}`, { feature: "setup-interview" });
  // JSON lines: the reply as Gemini writes it ({ type: "partial" }, or partial: null when a rejected answer is being
  // written again), a ping every 10 s, then { type: "done", result }. The owner reads the reply seconds in, while
  // the rest of the turn (questions, plan, the brief) is still being written.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => send({ type: "ping" }), 10_000);
      try {
        const result = await interviewTurn(
          parsed.data.messages,
          user.id,
          parsed.data.questions ?? [],
          (partial?: InterviewPartial) => send({ type: "partial", partial: partial ?? null }),
        );
        send({ type: "done", result });
      } catch (e) {
        console.error(
          JSON.stringify({ event: "interview_failed", message: e instanceof Error ? e.message : String(e) }),
        );
        send({ type: "done", result: { ok: false, message: "Something went wrong. Try again." } });
      } finally {
        clearInterval(ping);
        open = false;
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
