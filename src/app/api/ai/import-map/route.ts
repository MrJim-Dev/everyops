import { z } from "zod";
import { generateJsonHedged } from "@/server/ai/gemini";
import {
  checkedMapping,
  IMPORT_MAP_SYSTEM,
  importMapAnswer,
  importMapPrompt,
} from "@/server/ai/import-map-prompt";
import { takeAiToken } from "@/server/ai/rate-limit";
import { enterAiUsage, startAiUsage } from "@/server/ai/usage";
import { apiUser, sameOrigin } from "@/server/session-api";

const body = z.object({
  entityName: z.string().max(120),
  fields: z
    .array(
      z.object({
        id: z.string().max(80),
        name: z.string().max(120),
        type: z.string().max(40),
        options: z.array(z.string().max(80)).max(40).optional(),
      }),
    )
    .max(80),
  columns: z
    .array(
      z.object({
        index: z.number().int().min(0),
        header: z.string().max(120),
        samples: z.array(z.string().max(200)).max(5),
      }),
    )
    .min(1)
    .max(60),
  taken: z.array(z.string().max(80)).max(80).default([]),
});

/**
 * Suggests fields for the columns the import dialog couldn't match by name. Advisory: the owner sees and can change
 * every match before importing, and the rows are checked in the browser either way.
 */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Nothing to match." }, { status: 400 });
  if (!(await takeAiToken(user.id)).ok)
    return Response.json({ ok: false, message: "Wait a few minutes and try again." }, { status: 429 });
  const overBudget = await startAiUsage(`account:${user.id}`);
  if (overBudget) return overBudget;
  enterAiUsage(`account:${user.id}`);
  const { entityName, fields, columns, taken } = parsed.data;
  const result = await generateJsonHedged(
    importMapAnswer,
    {
      system: IMPORT_MAP_SYSTEM,
      prompt: importMapPrompt(entityName, fields, columns, taken),
      task: "import-map",
      thinking: "LOW",
      // A match takes 5–8 s. Vertex's global endpoint now and then stalls a call outright: one that has sent nothing
      // for 12 s is replaced, so a stall costs seconds rather than the whole wait.
      timeoutMs: 30_000,
      firstPartMs: 12_000,
      idleMs: 8_000,
      maxOutputTokens: 1500,
    },
    { hedgeMs: 12_000, afterSilence: true, attempts: 3 },
  );
  if (!result.ok) return Response.json({ ok: false, message: result.error }, { status: 502 });
  return Response.json({ ok: true, mapping: checkedMapping(result.data, fields, columns, taken) });
}
