import { z } from "zod";
import type { Blueprint } from "@/lib/blueprint/types";
import { planChangeWithGemini } from "@/server/ai/plan-change";
import { takeAiToken } from "@/server/ai/rate-limit";
import { auth } from "@/server/auth";

const body = z.object({
  request: z.string().trim().min(3).max(500),
  // The workspace still lives in the browser, so the client sends its blueprint. It is size-limited here
  // and every operation Gemini returns is checked against it before the plan is sent back.
  blueprint: z
    .object({ version: z.number(), workspaceName: z.string(), entities: z.array(z.any()) })
    .passthrough(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ ok: false, message: "Sign in to ask for changes." }, { status: 401 });

  const raw = await request.text();
  if (raw.length > 300_000)
    return Response.json({ ok: false, message: "This workspace is too large to send." }, { status: 413 });
  const parsed = body.safeParse(JSON.parse(raw || "null"));
  if (!parsed.success)
    return Response.json({ ok: false, message: "Describe the change in a few words." }, { status: 400 });

  const limit = takeAiToken(session.user.id);
  if (!limit.ok)
    return Response.json(
      { ok: false, message: "You've asked for a lot of changes. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );

  const result = await planChangeWithGemini(
    parsed.data.blueprint as unknown as Blueprint,
    parsed.data.request,
  );
  if (result.ok) return Response.json(result);
  return Response.json(result, { status: result.kind === "error" ? 502 : 200 });
}
