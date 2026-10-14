import "server-only";
import {
  type Content,
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
} from "@google/genai";
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

/**
 * Read-only functions Gemini may call while it answers (the assistant's record lookups). Each round's calls run, their
 * results go back, and Gemini continues; the last round has tools off so it has to answer.
 */
export type ToolSet = {
  declarations: { name: string; description: string; parametersJsonSchema: unknown }[];
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Rounds of calls before Gemini must answer (default 3). */
  maxRounds?: number;
};

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
  /** Cancels the call (a hedged twin already answered). */
  signal?: AbortSignal;
  /** Caps the answer. A looping answer then fails fast (and is retried) instead of running for a minute. */
  maxOutputTokens?: number;
  /** Longest text value the answer may hold before it counts as a runaway (default 3,000 characters). */
  maxStringChars?: number;
  /**
   * Sends literals as one-value enums, which Vertex enforces (it ignores const). It makes the schema count for more
   * against Gemini's structural limit, so it's on only where it was needed and fits: the designer.
   */
  enumLiterals?: boolean;
  tools?: ToolSet;
};

/**
 * JSON Schema for Gemini's structured output, without the keywords it doesn't need. Literals become one-value
 * enums: Vertex enforces enum but not const, and without it Gemini wrote view types that don't exist
 * ("approval" for approval_queue) and lost the shape of the answer from there.
 */
function responseSchema(schema: z.ZodType, enumLiterals = false) {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;
  return enumLiterals ? (constToEnum(rest) as Record<string, unknown>) : rest;
}

function constToEnum(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(constToEnum);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) =>
      key === "const" ? ["enum", [value]] : [key, constToEnum(value)],
    ),
  );
}

/**
 * Watches streamed JSON for a runaway: Gemini sometimes stops closing a string and repeats filler ("Go! Go! Go!",
 * "…_done_now_perfectly_setup…") or writes a number that never ends, until it hits the token limit a minute later.
 * Spotted within seconds, the call is stopped and a fresh one starts. Returns why, or null while all is well.
 */
export function runawayWatcher(maxStringChars = 3000) {
  let inString = false;
  let escaped = false;
  let length = 0;
  let unbroken = 0;
  let digits = 0;
  return (chunk: string): string | null => {
    for (const ch of chunk) {
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") {
          escaped = true;
          continue;
        } else if (ch === '"') {
          inString = false;
          continue;
        }
        length++;
        unbroken = ch === " " || ch === "\n" ? 0 : unbroken + 1;
        if (length > maxStringChars) return "a text value that never ends";
        if (unbroken > 160) return "text with no spaces that never ends";
      } else if (ch === '"') {
        inString = true;
        length = 0;
        unbroken = 0;
        digits = 0;
      } else if (/[0-9.eE+-]/.test(ch)) {
        if (++digits > 40) return "a number that never ends";
      } else digits = 0;
    }
    return null;
  };
}

/** Asks Gemini for JSON that matches `schema`, then parses it with the same schema. */
export async function generateJson<T>(schema: z.ZodType<T>, input: Input): Promise<GenerateResult<T>> {
  const started = Date.now();
  // Our own controller stops a runaway; the caller's signal (a hedged twin answered) and the timeout stop it too.
  const stop = new AbortController();
  const signals = [AbortSignal.timeout(input.timeoutMs ?? 20_000), stop.signal];
  if (input.signal) signals.push(input.signal);
  let runaway: string | null = null;
  let text = "";
  const contents: Content[] = [
    { role: "user", parts: typeof input.prompt === "string" ? [{ text: input.prompt }] : input.prompt },
  ];
  const usage = { input: 0, output: 0, thinking: 0 };
  let calls = 0;
  try {
    const rounds = input.tools ? (input.tools.maxRounds ?? 3) + 1 : 1;
    for (let round = 0; round < rounds; round++) {
      const last = round === rounds - 1;
      const stream = await gemini().models.generateContentStream({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction: input.system,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          responseMimeType: "application/json",
          responseJsonSchema: responseSchema(schema, input.enumLiterals),
          ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
          ...(input.thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel[input.thinking] } } : {}),
          ...(input.tools
            ? {
                tools: [{ functionDeclarations: input.tools.declarations }],
                ...(last
                  ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } }
                  : {}),
              }
            : {}),
          abortSignal: AbortSignal.any(signals),
        },
      });
      const watch = runawayWatcher(input.maxStringChars);
      // Parts are kept as Gemini sent them: calls carry thought signatures it needs back on the next round.
      const parts: Part[] = [];
      let roundUsage:
        | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
        | undefined;
      text = "";
      for await (const chunk of stream) {
        parts.push(...(chunk.candidates?.[0]?.content?.parts ?? []));
        const part = (chunk.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("");
        text += part;
        if (chunk.usageMetadata) roundUsage = chunk.usageMetadata;
        runaway = watch(part);
        if (runaway) {
          stop.abort();
          break;
        }
      }
      usage.input += roundUsage?.promptTokenCount ?? 0;
      usage.output += roundUsage?.candidatesTokenCount ?? 0;
      usage.thinking += roundUsage?.thoughtsTokenCount ?? 0;
      const wanted = parts.filter((p) => p.functionCall);
      if (runaway || !wanted.length || !input.tools) break;
      calls += wanted.length;
      const tools = input.tools;
      const results = await Promise.all(
        wanted.map(async (p) => {
          const call = p.functionCall as NonNullable<Part["functionCall"]>;
          const output = await tools.run(call.name ?? "", (call.args ?? {}) as Record<string, unknown>);
          return {
            functionResponse: {
              name: call.name,
              ...(call.id ? { id: call.id } : {}),
              response: { output: JSON.stringify(output).slice(0, 12_000) },
            },
          } satisfies Part;
        }),
      );
      contents.push({ role: "model", parts }, { role: "user", parts: results });
    }
    const ms = Date.now() - started;
    if (runaway) {
      console.warn(
        JSON.stringify({
          event: "gemini_runaway",
          task: input.task,
          model: GEMINI_MODEL,
          ms,
          why: runaway,
          chars: text.length,
        }),
      );
      return { ok: false, error: "Gemini got stuck repeating itself.", retryable: true };
    }
    const tokens = usage;
    console.info(
      JSON.stringify({
        event: "gemini",
        task: input.task,
        model: GEMINI_MODEL,
        ms,
        ...tokens,
        ...(input.tools ? { calls } : {}),
      }),
    );
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
          // The value at the first failing path, so the slip can be fixed in a repair or the prompt.
          failing: JSON.stringify(valueAt(cleaned, parsed.error.issues[0]?.path ?? [])).slice(0, 1500),
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
    if (input.signal?.aborted) return { ok: false, error: "Cancelled.", retryable: false };
    if (runaway) return { ok: false, error: "Gemini got stuck repeating itself.", retryable: true };
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

/**
 * generateJson with hedging: Vertex now and then stalls a call outright, so if the first call hasn't answered after
 * `hedgeMs` an identical second one starts, and the first good answer wins (the other is cancelled). A call that
 * fails fast and can be retried starts the next attempt straight away. A stall then costs seconds, not a timeout.
 */
export function generateJsonHedged<T>(
  schema: z.ZodType<T>,
  input: Input,
  options: { hedgeMs: number; attempts?: number },
): Promise<GenerateResult<T>> {
  return hedged((signal) => generateJson(schema, { ...input, signal }), {
    ...options,
    onHedge: (attempt) => console.info(JSON.stringify({ event: "gemini_hedge", task: input.task, attempt })),
  });
}

type Outcome = { ok: true } | { ok: false; retryable: boolean };

/** Runs `run` and, while no good answer is in, a fresh copy every `hedgeMs` (or at once after a retryable failure). */
export function hedged<R extends Outcome>(
  run: (signal: AbortSignal) => Promise<R>,
  {
    hedgeMs,
    attempts = 3,
    onHedge,
  }: { hedgeMs: number; attempts?: number; onHedge?: (attempt: number) => void },
): Promise<R> {
  return new Promise((resolve) => {
    let started = 0;
    let running = 0;
    let done = false;
    let last: R | undefined;
    const controllers: AbortController[] = [];
    const finish = (result: R) => {
      done = true;
      for (const c of controllers) c.abort();
      resolve(result);
    };
    const launch = () => {
      if (done || started >= attempts) return;
      started++;
      running++;
      const controller = new AbortController();
      controllers.push(controller);
      const hedge = setTimeout(() => {
        if (done || started >= attempts) return;
        onHedge?.(started + 1);
        launch();
      }, hedgeMs);
      void run(controller.signal).then((result) => {
        running--;
        clearTimeout(hedge);
        if (done) return;
        if (result.ok) return finish(result);
        last = result;
        if (result.retryable) launch();
        if (running === 0) finish(last);
      });
    };
    launch();
  });
}

function valueAt(value: unknown, path: PropertyKey[]): unknown {
  let at = value;
  for (const key of path) at = (at as Record<PropertyKey, unknown> | undefined)?.[key];
  return at;
}
