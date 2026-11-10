import "server-only";
import { mediaText } from "./media";
import { TRANSCRIBE_SYSTEM } from "./transcribe-prompt";

export type TranscribeResult = { ok: true; text: string } | { ok: false; message: string };

/**
 * Turns a voice recording into text the person can review before sending. The audio isn't kept. This runs on Gemini
 * (see media.ts): Claude doesn't take audio.
 */
export async function transcribe(audio: Uint8Array, mime: string): Promise<TranscribeResult> {
  // A voice note transcribes in about 3 s, so a call still quiet after 15 s is given up on and asked again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await mediaText({
      system: TRANSCRIBE_SYSTEM,
      prompt: "Transcribe this voice message. Answer with the transcript only.",
      media: { inlineData: { mimeType: mime, data: Buffer.from(audio).toString("base64") } },
      task: "transcribe",
      timeoutMs: 15_000,
      attempt,
    });
    if (result.ok) return { ok: true, text: result.text };
    if (!result.retryable) break;
  }
  return { ok: false, message: "We couldn't hear that clearly. Try again." };
}
