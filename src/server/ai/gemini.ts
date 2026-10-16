import "server-only";
import {
  type Content,
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
} from "@google/genai";
import { z } from "zod";
import { countTokens, recordAiCall } from "./usage";

/**
 * Gemini on Vertex AI. On Cloud Run the client signs in as the service account (everyops-run);
 * locally it uses Application Default Credentials from `gcloud auth login --update-adc`. No API keys.
 * gemini-3.7-flash is only served from the global endpoint (asia-southeast1 returns 404 for it).
 */
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "everyops-prod";
const LOCATION = process.env.GEMINI_LOCATION ?? "global";
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
/**
 * Setup's design calls (tasks starting with "design") can run on another model, e.g. GEMINI_DESIGN_MODEL=gemini-3.5-flash
 * with GEMINI_DESIGN_LOCATION=asia-southeast1: it writes a design about 2.5 times as fast as 3.7 Flash.
 */
const DESIGN_MODEL = process.env.GEMINI_DESIGN_MODEL || GEMINI_MODEL;
const DESIGN_LOCATION = process.env.GEMINI_DESIGN_LOCATION || LOCATION;

const clients = new Map<string, GoogleGenAI>();
function gemini(location: string) {
  let client = clients.get(location);
  if (!client) {
    client = new GoogleGenAI({ vertexai: true, project: PROJECT, location });
    clients.set(location, client);
  }
  return client;
}

function modelFor(task: string) {
  return task.startsWith("design")
    ? { model: DESIGN_MODEL, location: DESIGN_LOCATION }
    : { model: GEMINI_MODEL, location: LOCATION };
}

export type GenerateResult<T> =
  | {
      ok: true;
      data: T;
      model: string;
      ms: number;
      tokens: { input: number; output: number; thinking: number };
    }
  | { ok: false; error: string; retryable: boolean; rateLimited?: boolean; reason?: FailReason };

/** Why a call didn't produce an answer, as logged in ai_call (see AI_OUTCOMES). */
type FailReason =
  | "cancelled"
  | "runaway"
  | "stalled"
  | "timeout"
  | "schema"
  | "malformed"
  | "empty"
  | "rate-limited"
  | "error";

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
  /**
   * Cancels the call when no part of the answer has arrived for this long: Vertex now and then stalls a call midway,
   * and a stalled call should be replaced in seconds while a slow one that keeps streaming is left to finish.
   */
  idleMs?: number;
  /** The same, before the first part, which comes only after the model has thought (defaults to idleMs). */
  firstPartMs?: number;
  /** Called with each part that streams in (generateJsonHedged uses it to tell a stalled call from a slow one). */
  onProgress?: () => void;
  /** Called with the answer so far each time a part streams in (setup draws the design as it's written). */
  onText?: (text: string, attempt: number) => void;
  /** Fixes known harmless slips in Gemini's JSON before it's checked against the schema. */
  repair?: (json: unknown) => unknown;
  /** Overrides the model's default reasoning depth. Leave unset for Gemini 3 models. */
  thinking?: "LOW" | "MEDIUM" | "HIGH";
  /** Logged with token usage, e.g. "plan-change". */
  task: string;
  /** Cancels the call (a hedged twin already answered). */
  signal?: AbortSignal;
  /** Which hedged attempt this is (0 for the first), for the usage log. */
  attempt?: number;
  /** Caps the answer. A looping answer then fails fast (and is retried) instead of running for a minute. */
  maxOutputTokens?: number;
  /** Longest text value the answer may hold before it counts as a runaway (default 3,000 characters). */
  maxStringChars?: number;
  /**
   * Longest text, in characters, for values under these property names (e.g. { submitLabel: 40 }). Sent to Gemini
   * as maxLength, and a value that runs well past it is stopped as a runaway within a second or two. Gemini's loops
   * start in short text it fails to close: a two-word button label that turns into "Request Delivery Request…".
   */
  textLimits?: Record<string, number>;
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
function responseSchema(schema: z.ZodType, enumLiterals = false, textLimits?: Record<string, number>) {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;
  const out = enumLiterals ? (constToEnum(rest) as Record<string, unknown>) : rest;
  return textLimits ? (withTextLimits(out, textLimits) as Record<string, unknown>) : out;
}

/** Adds maxLength to the string properties (and lists of strings) named in `limits`. */
export function withTextLimits(node: unknown, limits: Record<string, number>): unknown {
  if (Array.isArray(node)) return node.map((n) => withTextLimits(n, limits));
  if (!node || typeof node !== "object") return node;
  const out = Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [
      key,
      withTextLimits(value, limits),
    ]),
  ) as Record<string, unknown>;
  const props = out.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && typeof props === "object")
    for (const [name, prop] of Object.entries(props)) {
      const max = limits[name];
      if (!max || !prop || typeof prop !== "object") continue;
      const items = prop.items as Record<string, unknown> | undefined;
      if (prop.type === "string" && !prop.enum) props[name] = { ...prop, maxLength: max };
      else if (prop.type === "array" && items?.type === "string" && !items.enum)
        props[name] = { ...prop, items: { ...items, maxLength: max } };
    }
  return out;
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
const BREAKS = new Set([" ", "\n", ";", ",", "{", "}", "<", ">"]);

/** A text value whose last 400 characters are one short phrase over and over ("complete matches complete matches…"). */
function repeating(tail: string): boolean {
  if (tail.length < 400) return false;
  for (let unit = 1; unit <= 40; unit++) {
    let i = tail.length - unit - 1;
    while (i >= 0 && tail[i] === tail[i + unit]) i--;
    if (tail.length - 1 - i >= 400 - unit) return true;
  }
  return false;
}

/**
 * Text that goes round in circles without repeating exactly: a few words shuffled over and over ("cool done very
 * soon easily ready go now…"). Real text, HTML included, uses far more different words in the same stretch.
 */
function circling(window: string): boolean {
  // Markup repeats by design (a grid of cards, a CSS file); only prose is judged by its words.
  if ((window.match(/[<{]/g)?.length ?? 0) > 10) return false;
  const words = window.toLowerCase().match(/[a-z]{2,}/g) ?? [];
  return words.length >= 200 && new Set(words).size / words.length < 0.08;
}

export function runawayWatcher(maxStringChars = 3000, textLimits: Record<string, number> = {}) {
  let inString = false;
  let escaped = false;
  let length = 0;
  let unbroken = 0;
  let digits = 0;
  let tail = "";
  let window = "";
  // The property a value belongs to: the last string closed before a colon. A short field gets 3× its limit.
  let current = "";
  let lastString = "";
  let key = "";
  let limit = maxStringChars;
  return (chunk: string): string | null => {
    for (const ch of chunk) {
      if (inString) {
        if (escaped) {
          escaped = false;
          // An escaped line break or tab ("\n") is a break in the text, like a space.
          if (ch === "n" || ch === "t" || ch === "r") {
            length++;
            unbroken = 0;
            continue;
          }
        } else if (ch === "\\") {
          escaped = true;
          continue;
        } else if (ch === '"') {
          inString = false;
          lastString = current;
          continue;
        }
        length++;
        tail = (tail + ch).slice(-400);
        window = (window + ch).slice(-2000);
        if (length <= 64) current += ch;
        // Checked every 20 characters: a short phrase repeating for 400 characters is a loop, however long it is.
        if (length % 20 === 0 && repeating(tail)) return "text that repeats itself";
        if (length % 200 === 0 && circling(window)) return "text that goes round in circles";
        // HTML and CSS run long without spaces (body{margin:0;font-family:…}); their punctuation breaks a run too.
        // Filler that never ends ("…_done_now_perfectly_setup_…") has none of it.
        unbroken = BREAKS.has(ch) ? 0 : unbroken + 1;
        if (length > maxStringChars) return "a text value that never ends";
        if (length > limit) return `a ${key} that never ends`;
        if (unbroken > 160) return "text with no spaces that never ends";
      } else if (ch === '"') {
        inString = true;
        length = 0;
        unbroken = 0;
        digits = 0;
        tail = "";
        window = "";
        current = "";
        limit = textLimits[key] ? textLimits[key] * 3 + 30 : maxStringChars;
      } else if (ch === ":") {
        key = lastString;
        digits = 0;
      } else if (/[0-9.eE+-]/.test(ch)) {
        if (++digits > 40) return "a number that never ends";
      } else digits = 0;
    }
    return null;
  };
}

type Usage = { input: number; output: number; thinking: number; cached: number };
type RoundUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
};
/** What one call has used so far, kept outside the call so a call that throws midway is still counted. */
type Meter = {
  usage: Usage;
  rounds: number;
  /** The round being streamed, until it completes. */
  round?: { promptChars: number; text: string; usage?: RoundUsage; started: boolean };
};

/** Characters of text sent in a round (the system instruction and every text part), for estimating its tokens. */
function promptChars(system: string, contents: Content[]): number {
  let n = system.length;
  for (const c of contents)
    for (const p of c.parts ?? [])
      n += p.text?.length ?? (p.functionResponse ? JSON.stringify(p.functionResponse).length : 0);
  return n;
}

/** About four characters a token, for text Gemini never reported usage for. */
const roughTokens = (chars: number) => Math.ceil(chars / 4);

/**
 * Asks Gemini for JSON that matches `schema`, then parses it with the same schema. Every call is logged to ai_call,
 * whatever its outcome: a twin cancelled because another answered, a loop that was stopped and a failure all used
 * tokens, and those are counted too (estimated from the text when Gemini didn't get to report them).
 */
export async function generateJson<T>(schema: z.ZodType<T>, input: Input): Promise<GenerateResult<T>> {
  const started = Date.now();
  const { model, location } = modelFor(input.task);
  const meter: Meter = { usage: { input: 0, output: 0, thinking: 0, cached: 0 }, rounds: 0 };
  const result = await generateJsonOnce(schema, input, meter);
  const reason = result.ok ? "ok" : (result.reason ?? "error");
  let estimated = false;
  const round = meter.round;
  if (round) {
    // The call stopped midway through a round (cancelled, stalled, timed out, failed). Gemini bills what it read and
    // wrote; when it didn't report the numbers, estimate them, but only if it had started on the request.
    const reported = round.usage;
    const stoppedByUs = ["cancelled", "stalled", "timeout", "runaway"].includes(reason);
    if (reported?.promptTokenCount) {
      meter.usage.input += reported.promptTokenCount;
      meter.usage.cached += reported.cachedContentTokenCount ?? 0;
      meter.usage.thinking += reported.thoughtsTokenCount ?? 0;
      const written = roughTokens(round.text.length);
      meter.usage.output += Math.max(reported.candidatesTokenCount ?? 0, written);
      estimated = !reported.candidatesTokenCount && written > 0;
    } else if (round.started || stoppedByUs) {
      meter.usage.input += roughTokens(round.promptChars);
      meter.usage.output += roughTokens(round.text.length);
      estimated = true;
    }
    meter.rounds++;
  }
  const u = meter.usage;
  countTokens(u.input + u.output + u.thinking);
  recordAiCall({
    task: input.task,
    model,
    location,
    attempt: input.attempt ?? 0,
    rounds: Math.max(1, meter.rounds),
    outcome: reason,
    tokens: u,
    estimated,
    ms: Date.now() - started,
  });
  return result;
}

async function generateJsonOnce<T>(
  schema: z.ZodType<T>,
  input: Input,
  meter: Meter,
): Promise<GenerateResult<T>> {
  const started = Date.now();
  const { model: MODEL, location } = modelFor(input.task);
  // Our own controller stops a runaway; the caller's signal (a hedged twin answered) and the timeout stop it too.
  const stop = new AbortController();
  // A call with no new part for idleMs is stalled: this controller stops it.
  const idle = new AbortController();
  const signals = [AbortSignal.timeout(input.timeoutMs ?? 20_000), stop.signal, idle.signal];
  if (input.signal) signals.push(input.signal);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const quietFor = (ms: number | undefined) => {
    clearTimeout(idleTimer);
    if (ms)
      idleTimer = setTimeout(() => {
        stalled = true;
        idle.abort();
      }, ms);
  };
  let firstMs: number | undefined;
  let runaway: string | null = null;
  let text = "";
  const contents: Content[] = [
    { role: "user", parts: typeof input.prompt === "string" ? [{ text: input.prompt }] : input.prompt },
  ];
  // cached: input tokens Gemini reused from an identical prompt start (implicit caching), billed and read for less.
  const usage = meter.usage;
  let calls = 0;
  try {
    const rounds = input.tools ? (input.tools.maxRounds ?? 3) + 1 : 1;
    for (let round = 0; round < rounds; round++) {
      const last = round === rounds - 1;
      quietFor(input.firstPartMs ?? input.idleMs);
      const streaming: NonNullable<Meter["round"]> = {
        promptChars: promptChars(input.system, contents),
        text: "",
        started: false,
      };
      meter.round = streaming;
      const stream = await gemini(location).models.generateContentStream({
        model: MODEL,
        contents,
        config: {
          systemInstruction: input.system,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          responseMimeType: "application/json",
          responseJsonSchema: responseSchema(schema, input.enumLiterals, input.textLimits),
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
      const watch = runawayWatcher(input.maxStringChars, input.textLimits);
      // Parts are kept as Gemini sent them: calls carry thought signatures it needs back on the next round.
      const parts: Part[] = [];
      let roundUsage: RoundUsage | undefined;
      text = "";
      for await (const chunk of stream) {
        firstMs ??= Date.now() - started;
        quietFor(input.idleMs);
        input.onProgress?.();
        parts.push(...(chunk.candidates?.[0]?.content?.parts ?? []));
        const part = (chunk.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("");
        text += part;
        if (chunk.usageMetadata) roundUsage = chunk.usageMetadata;
        streaming.started = true;
        streaming.usage = roundUsage;
        streaming.text = text;
        if (part) input.onText?.(text, 0);
        runaway = watch(part);
        if (runaway) {
          stop.abort();
          break;
        }
      }
      quietFor(undefined);
      usage.input += roundUsage?.promptTokenCount ?? 0;
      usage.output += roundUsage?.candidatesTokenCount ?? 0;
      usage.thinking += roundUsage?.thoughtsTokenCount ?? 0;
      usage.cached += roundUsage?.cachedContentTokenCount ?? 0;
      // A runaway's answer was cut short: count what it wrote if Gemini hadn't reported it yet.
      if (runaway && !roundUsage?.candidatesTokenCount) usage.output += roughTokens(text.length);
      meter.rounds++;
      meter.round = undefined;
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
              response: { output: fitToolOutput(output, 12_000) },
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
          model: MODEL,
          ms,
          why: runaway,
          chars: text.length,
          // The end of what came back, to tell a real runaway from an answer that's just long.
          tail: text.slice(-160),
        }),
      );
      return { ok: false, error: "Gemini got stuck repeating itself.", retryable: true, reason: "runaway" };
    }
    const tokens = usage;
    console.info(
      JSON.stringify({
        event: "gemini",
        task: input.task,
        model: MODEL,
        ms,
        ...(firstMs === undefined ? {} : { firstMs }),
        ...tokens,
        ...(input.tools ? { calls } : {}),
      }),
    );
    if (!text)
      return { ok: false, error: "Gemini returned an empty answer.", retryable: true, reason: "empty" };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: "Gemini returned malformed JSON.", retryable: true, reason: "malformed" };
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
        // The details are in the log above; people only need to know it didn't come together.
        error: "Gemini's answer came back incomplete. Try again.",
        retryable: true,
        reason: "schema",
      };
    }
    return { ok: true, data: parsed.data, model: MODEL, ms, tokens };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.signal?.aborted)
      return { ok: false, error: "Cancelled.", retryable: false, reason: "cancelled" };
    if (runaway)
      return { ok: false, error: "Gemini got stuck repeating itself.", retryable: true, reason: "runaway" };
    if (stalled) {
      console.warn(
        JSON.stringify({
          event: "gemini_stalled",
          task: input.task,
          model: MODEL,
          ms: Date.now() - started,
          firstMs,
          chars: text.length,
        }),
      );
      return { ok: false, error: "Gemini took too long to answer.", retryable: true, reason: "stalled" };
    }
    console.error(JSON.stringify({ event: "gemini_error", task: input.task, model: MODEL, message }));
    const timedOut = /abort|timeout/i.test(message);
    // Out of quota: retried, but only after a pause (see hedged), since asking again at once only adds to the load.
    const rateLimited = /\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(message);
    // A dropped connection ("terminated" is undici's word for a response cut off mid-stream), a reset socket or a
    // busy Vertex answers fine on the next try. A bad request (400) does not, so it stays final.
    const transient =
      /terminated|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket|fetch failed|other side closed|\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL/i.test(
        message,
      );
    return {
      ok: false,
      error: timedOut
        ? "Gemini took too long to answer."
        : rateLimited
          ? "Gemini is busy right now. Try again in a minute."
          : "Gemini is unavailable right now.",
      retryable: timedOut || transient || rateLimited,
      reason: timedOut ? "timeout" : rateLimited ? "rate-limited" : "error",
      ...(rateLimited ? { rateLimited: true } : {}),
    };
  } finally {
    clearTimeout(idleTimer);
  }
}

/**
 * A lookup result as JSON of at most `max` characters. Cutting the text instead left Gemini half a record and broken
 * JSON; here the longest list loses rows until it fits, and a note says how many are left out.
 */
export function fitToolOutput(output: unknown, max: number): string {
  const whole = JSON.stringify(output) ?? "null";
  if (whole.length <= max) return whole;
  const copy = JSON.parse(whole) as unknown;
  const lists: unknown[][] = [];
  const collect = (node: unknown) => {
    if (Array.isArray(node)) {
      lists.push(node);
      node.forEach(collect);
    } else if (node && typeof node === "object") Object.values(node).forEach(collect);
  };
  collect(copy);
  const longest = lists.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  if (longest && longest.length > 1) {
    const total = longest.length;
    let text = whole;
    while (longest.length > 1) {
      longest.splice(Math.max(1, Math.floor(longest.length * 0.75)));
      text = JSON.stringify({
        result: copy,
        cut: `Only the first ${longest.length} of ${total} items fit here. Ask a narrower lookup for the rest.`,
      });
      if (text.length <= max) return text;
    }
  }
  return JSON.stringify({
    cut: "This result was too large to show. Ask a narrower lookup.",
    preview: whole.slice(0, Math.max(0, max - 200)),
  });
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
 * With afterSilence, hedgeMs counts from the last part that streamed in, so a long answer that keeps coming gets no twin.
 */
export function generateJsonHedged<T>(
  schema: z.ZodType<T>,
  input: Input,
  options: {
    hedgeMs: number;
    attempts?: number;
    afterSilence?: boolean;
    /** Added to the prompt from the second attempt on, so a retry isn't the same call that just looped. */
    retryNote?: string;
  },
): Promise<GenerateResult<T>> {
  const { retryNote, ...rest } = options;
  const promptFor = (attempt: number): Input["prompt"] =>
    attempt === 0 || !retryNote
      ? input.prompt
      : typeof input.prompt === "string"
        ? `${input.prompt}\n\n${retryNote}`
        : [...input.prompt, { text: retryNote }];
  return hedged(
    (signal, progress, attempt) =>
      generateJson(schema, {
        ...input,
        prompt: promptFor(attempt),
        attempt,
        // The caller's signal (the owner left, or setup ran out of time) stops every twin as well.
        signal: input.signal ? AbortSignal.any([signal, input.signal]) : signal,
        onProgress: progress,
        onText: input.onText && ((text) => input.onText?.(text, attempt)),
      }),
    {
      ...rest,
      onHedge: (attempt) =>
        console.info(JSON.stringify({ event: "gemini_hedge", task: input.task, attempt })),
    },
  );
}

type Outcome = { ok: true } | { ok: false; retryable: boolean; rateLimited?: boolean };

/** How long to wait before asking again after an out-of-quota answer: about 2, 4, then 8 s, with some jitter. */
export function quotaPause(failures: number, random = Math.random): number {
  return Math.min(8_000, 2_000 * 2 ** failures) * (0.75 + random() * 0.5);
}

/**
 * Runs `run` and, while no good answer is in, a fresh copy every `hedgeMs` (or at once after a retryable failure).
 * With afterSilence, a call's hedgeMs starts over each time it reports progress, and each call starts at most one twin.
 * After an out-of-quota failure the next copy waits (quotaPause), and no twins start while waiting.
 */
export function hedged<R extends Outcome>(
  run: (signal: AbortSignal, progress: () => void, attempt: number) => Promise<R>,
  {
    hedgeMs,
    attempts = 3,
    afterSilence = false,
    onHedge,
  }: { hedgeMs: number; attempts?: number; afterSilence?: boolean; onHedge?: (attempt: number) => void },
): Promise<R> {
  return new Promise((resolve) => {
    let started = 0;
    let running = 0;
    let waiting = false;
    let quotaFailures = 0;
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
      const attempt = started;
      started++;
      running++;
      const controller = new AbortController();
      controllers.push(controller);
      let fired = false;
      let hedge: ReturnType<typeof setTimeout> | undefined;
      const wait = () => {
        clearTimeout(hedge);
        hedge = setTimeout(() => {
          fired = true;
          if (done || waiting || quotaFailures || started >= attempts) return;
          onHedge?.(started + 1);
          launch();
        }, hedgeMs);
      };
      wait();
      const progress = () => {
        if (afterSilence && !fired && !done) wait();
      };
      void run(controller.signal, progress, attempt).then((result) => {
        running--;
        clearTimeout(hedge);
        if (done) return;
        if (result.ok) return finish(result);
        last = result;
        if (result.retryable && result.rateLimited && !waiting && started < attempts) {
          waiting = true;
          setTimeout(() => {
            waiting = false;
            launch();
            if (running === 0 && !done) finish(last as R);
          }, quotaPause(quotaFailures++));
          return;
        }
        if (result.retryable && !waiting) launch();
        if (running === 0 && !waiting) finish(last);
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
