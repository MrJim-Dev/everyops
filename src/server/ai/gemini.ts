import "server-only";
import { GoogleGenAI, type Part, ThinkingLevel } from "@google/genai";
import { z } from "zod";

/**
 * Gemini on Vertex AI. On Cloud Run the client signs in as the service account (everyops-run);
 * locally it uses Application Default Credentials from `gcloud auth login --update-adc`. No API keys.
 */
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "everyops-prod";
const LOCATION = process.env.GEMINI_LOCATION ?? "asia-southeast1";
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

let client: GoogleGenAI | undefined;
function gemini() {
  client ??= new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  return client;
}

export type GenerateResult<T> =
  | {
      ok: true;
      data: T;
      model: string;
      ms: number;
      tokens: { input: number; output: number; thinking: number };
    }
  | { ok: false; error: string; retryable: boolean };

type Input = {
  system: string;
  /** The user turn: plain text, or text plus inline images (e.g. a photographed menu). */
  prompt: string | Part[];
  /** Leave unset: Gemini 3 models are tuned for the default temperature and can loop when it is lowered. */
  temperature?: number;
  timeoutMs?: number;
  /** Fixes known harmless slips in Gemini's JSON before it's checked against the schema. */
  repair?: (json: unknown) => unknown;
  /** Overrides the model's default reasoning depth. Leave unset for Gemini 3 models. */
  thinking?: "LOW" | "MEDIUM" | "HIGH";
  /** Logged with token usage, e.g. "plan-change". */
  task: string;
};

/** JSON Schema for Gemini's structured output, without the keywords it doesn't need. */
function responseSchema(schema: z.ZodType) {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;
  return rest;
}

/** Asks Gemini for JSON that matches `schema`, then parses it with the same schema. */
export async function generateJson<T>(schema: z.ZodType<T>, input: Input): Promise<GenerateResult<T>> {
  const started = Date.now();
  try {
    const response = await gemini().models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        { role: "user", parts: typeof input.prompt === "string" ? [{ text: input.prompt }] : input.prompt },
      ],
      config: {
        systemInstruction: input.system,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema(schema),
        ...(input.thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel[input.thinking] } } : {}),
        abortSignal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
      },
    });
    const ms = Date.now() - started;
    const usage = response.usageMetadata;
    const tokens = {
      input: usage?.promptTokenCount ?? 0,
      output: usage?.candidatesTokenCount ?? 0,
      thinking: usage?.thoughtsTokenCount ?? 0,
    };
    console.info(JSON.stringify({ event: "gemini", task: input.task, model: GEMINI_MODEL, ms, ...tokens }));
    const text = response.text;
    if (!text) return { ok: false, error: "Gemini returned an empty answer.", retryable: true };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: "Gemini returned malformed JSON.", retryable: true };
    }
    const cleaned = withoutNulls(json);
    const parsed = schema.safeParse(input.repair ? input.repair(cleaned) : cleaned);
    if (!parsed.success) {
      console.warn(
        JSON.stringify({
          event: "gemini_schema_mismatch",
          task: input.task,
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
          sample: text.slice(0, 1500),
        }),
      );
      return {
        ok: false,
        error: `Gemini's answer didn't match the schema: ${parsed.error.message}`,
        retryable: true,
      };
    }
    return { ok: true, data: parsed.data, model: GEMINI_MODEL, ms, tokens };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "gemini_error", task: input.task, model: GEMINI_MODEL, message }));
    const timedOut = /abort|timeout/i.test(message);
    return {
      ok: false,
      error: timedOut ? "Gemini took too long to answer." : "Gemini is unavailable right now.",
      retryable: timedOut,
    };
  }
}

/** Gemini sometimes writes null for an optional field it means to leave out; drop those keys before validating. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, withoutNulls(v)]),
    );
  return value;
}
