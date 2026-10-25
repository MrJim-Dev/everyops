import { detectFile } from "@/server/ai/attachments";
import { takeAiToken } from "@/server/ai/rate-limit";
import { transcribe } from "@/server/ai/transcribe";
import { enterAiUsage, startAiUsage } from "@/server/ai/usage";
import { apiUser, sameOrigin } from "@/server/session-api";

/** About four minutes of compressed speech; the browser stops recording well before that. */
const MAX_AUDIO_BYTES = 8_000_000;

/** Voice input for every AI prompt: a recording in, the words as text out. */
export async function POST(request: Request) {
  const { user, error } = await apiUser(request);
  if (error) return error;
  if (!sameOrigin(request)) return Response.json({ ok: false, message: "Forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob) || !file.size)
    return Response.json({ ok: false, message: "Nothing was recorded." }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES)
    return Response.json(
      { ok: false, message: "That recording is too long. Keep it under 2 minutes." },
      { status: 413 },
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectFile(bytes, "", file.type.startsWith("audio/") ? file.type : "audio/webm");
  if (!type || (type.kind !== "audio" && type.kind !== "video"))
    return Response.json({ ok: false, message: "That recording format isn't supported." }, { status: 415 });
  if (!(await takeAiToken(`voice:${user.id}`)).ok)
    return Response.json(
      { ok: false, message: "That's a lot of voice messages. Wait a few minutes and try again." },
      { status: 429 },
    );
  const overBudget = await startAiUsage(`account:${user.id}`, { userId: user.id, feature: "voice" });
  if (overBudget) return overBudget;
  enterAiUsage(`account:${user.id}`, { feature: "voice" });
  const mime = type.mime.replace(/^video\//, "audio/");
  const result = await transcribe(bytes, mime);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
