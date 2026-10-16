import "server-only";
import { generateJsonHedged } from "./gemini";
import { TRANSCRIBE_SYSTEM, transcript } from "./transcribe-prompt";

export type TranscribeResult = { ok: true; text: string } | { ok: false; message: string };

/** Turns a voice recording into text the person can review before sending. The audio isn't kept. */
export async function transcribe(audio: Uint8Array, mime: string): Promise<TranscribeResult> {
  // A voice note transcribes in about 3 s; one that has sent nothing for 10 s has stalled and gets a twin.
  const result = await generateJsonHedged(
    transcript,
    {
      system: TRANSCRIBE_SYSTEM,
      prompt: [
        { inlineData: { mimeType: mime, data: Buffer.from(audio).toString("base64") } },
        { text: "Transcribe this voice message." },
      ],
      timeoutMs: 30_000,
      task: "transcribe",
    },
    { hedgeMs: 10_000, afterSilence: true, attempts: 3 },
  );
  if (result.ok) return { ok: true, text: result.data.text.trim() };
  return {
    ok: false,
    message: result.retryable ? "Gemini couldn't hear that clearly. Try again." : result.error,
  };
}
