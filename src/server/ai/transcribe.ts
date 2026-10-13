import "server-only";
import { generateJson } from "./gemini";
import { TRANSCRIBE_SYSTEM, transcript } from "./transcribe-prompt";

export type TranscribeResult = { ok: true; text: string } | { ok: false; message: string };

/** Turns a voice recording into text the person can review before sending. The audio isn't kept. */
export async function transcribe(audio: Uint8Array, mime: string): Promise<TranscribeResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateJson(transcript, {
      system: TRANSCRIBE_SYSTEM,
      prompt: [
        { inlineData: { mimeType: mime, data: Buffer.from(audio).toString("base64") } },
        { text: "Transcribe this voice message." },
      ],
      timeoutMs: 30_000,
      task: "transcribe",
    });
    if (result.ok) return { ok: true, text: result.data.text.trim() };
    if (!result.retryable) return { ok: false, message: result.error };
  }
  return { ok: false, message: "Gemini couldn't hear that clearly. Try again." };
}
