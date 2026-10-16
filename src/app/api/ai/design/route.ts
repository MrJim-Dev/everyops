import { z } from "zod";
import { attachmentRef } from "@/lib/assistant/attachments";
import type { DesignStreamEvent } from "@/lib/assistant/design-sketch";
import { blueprintPreview } from "@/lib/assistant/preview";
import { designWorkspace } from "@/server/ai/design";
import { takeAiToken } from "@/server/ai/rate-limit";
import { apiUser, sameOrigin } from "@/server/session-api";

const body = z.object({
  brief: z.string().min(20).max(12_000),
  workspaceName: z.string().max(80).default(""),
  /** The files from the setup conversation, so real items and prices end up in the workspace. */
  attachments: z.array(attachmentRef).max(12).default([]),
  /** The community system the interview chose to start from (the template route). */
  base: z.string().max(80).optional(),
});

/**
 * Designs a workspace and streams its progress as JSON lines (DesignStreamEvent): the step it's on, a sketch of the
 * pages as Gemini writes them, then the draft or an error. A ping every 10 s keeps quiet stretches from looking like a
 * dropped connection. Closing the page stops the design.
 */
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: DesignStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => send({ type: "ping" }), 10_000);
      try {
        const result = await designWorkspace(parsed.data.brief, parsed.data.workspaceName, {
          files: { userId: user.id, attachments: parsed.data.attachments },
          onEvent: send,
          signal: request.signal,
          ...(parsed.data.base ? { base: parsed.data.base } : {}),
        });
        if (result.ok)
          send({
            type: "done",
            draft: {
              name: result.name,
              summary: result.summary,
              data: result.data,
              preview: blueprintPreview(result.data),
              coverage: result.coverage,
              ...(result.gaps?.length ? { gaps: result.gaps } : {}),
            },
          });
        else send({ type: "error", message: result.message });
      } catch (e) {
        console.error(
          JSON.stringify({ event: "design_failed", message: e instanceof Error ? e.message : String(e) }),
        );
        send({ type: "error", message: "Something went wrong. Try again." });
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
