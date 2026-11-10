import "server-only";
import { GoogleGenAI, type Part } from "@google/genai";
import { countTokens, recordAiCall } from "./usage";

/**
 * Sound and video. Claude reads text, pictures and PDFs but can't hear or watch, so a voice message is transcribed,
 * and an attached recording or clip is written up, by Gemini on Vertex AI before Claude sees it. Vertex signs in as
 * the Cloud Run service account (locally, gcloud's Application Default Credentials). Nothing else runs on Gemini.
 */
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "everyops-prod";
const LOCATION = process.env.GEMINI_LOCATION ?? "global";
export const MEDIA_MODEL = process.env.GEMINI_MEDIA_MODEL || "gemini-3.7-flash";

let client: GoogleGenAI | undefined;
const gemini = () => {
  client ??= new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  return client;
};

export type MediaResult = { ok: true; text: string } | { ok: false; retryable: boolean };

/** One Gemini call that listens to (or watches) `media` and answers in plain text. Logged to ai_call like any other. */
export async function mediaText(input: {
  system: string;
  prompt: string;
  media: Part;
  task: string;
  timeoutMs?: number;
  attempt?: number;
}): Promise<MediaResult> {
  const started = Date.now();
  const tokens = { input: 0, cached: 0, output: 0, thinking: 0 };
  let outcome = "ok";
  try {
    const response = await gemini().models.generateContent({
      model: MEDIA_MODEL,
      contents: [{ role: "user", parts: [input.media, { text: input.prompt }] }],
      config: {
        systemInstruction: input.system,
        abortSignal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
      },
    });
    const u = response.usageMetadata;
    tokens.input = u?.promptTokenCount ?? 0;
    tokens.cached = u?.cachedContentTokenCount ?? 0;
    tokens.output = u?.candidatesTokenCount ?? 0;
    tokens.thinking = u?.thoughtsTokenCount ?? 0;
    return { ok: true, text: (response.text ?? "").trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "media_error", task: input.task, model: MEDIA_MODEL, message }));
    const timedOut = /abort|timeout/i.test(message);
    outcome = timedOut ? "timeout" : "error";
    return { ok: false, retryable: timedOut || !/\b400\b|INVALID_ARGUMENT/.test(message) };
  } finally {
    countTokens(tokens.input + tokens.output + tokens.thinking);
    recordAiCall({
      task: input.task,
      model: MEDIA_MODEL,
      location: LOCATION,
      attempt: input.attempt ?? 0,
      rounds: 1,
      outcome,
      tokens,
      estimated: false,
      ms: Date.now() - started,
    });
  }
}

const DESCRIBE_SYSTEM = `You write up a recording or video clip that a small business owner attached to a message in
EveryOps, a workspace app, for an assistant that can't hear or watch it. Write every word that is said, in the language
it is said in, and name who is speaking when that is clear. For video, also describe what is shown that the words don't
cover: text on screen, products, prices, documents, places, and what happens. Plain text, no opinions, nothing made up.
If there is nothing to hear or see, say so.`;

/** What an attached recording or clip says and shows, as text. `uri` is the file's Cloud Storage address. */
export async function describeMedia(
  uri: string,
  mime: string,
  kind: "audio" | "video",
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await mediaText({
      system: DESCRIBE_SYSTEM,
      prompt: kind === "audio" ? "Write up this recording." : "Write up this video.",
      media: { fileData: { fileUri: uri, mimeType: mime } },
      task: "media",
      timeoutMs: 90_000,
      attempt,
    });
    if (result.ok) return result.text || null;
    if (!result.retryable) return null;
  }
  return null;
}
