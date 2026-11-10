import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { countTokens, recordAiCall } from "./usage";

/**
 * Claude through the Anthropic API. The key is ANTHROPIC_API_KEY: a Secret Manager secret on Cloud Run, .env.local
 * on a laptop. Most work runs on CLAUDE_MODEL (Sonnet). The small steps that run many times a message (FAST_TASKS)
 * run on CLAUDE_FAST_MODEL (Haiku), which costs a twentieth as much and answers sooner. Setup's design calls (tasks
 * starting with "design") can run on their own model with CLAUDE_DESIGN_MODEL.
 */
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const FAST_MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-5-5";
const DESIGN_MODEL = process.env.CLAUDE_DESIGN_MODEL || CLAUDE_MODEL;
/** Logged with each call. The API has one endpoint; Anthropic serves a request from wherever it has room. */
const LOCATION = "global";

/**
 * Steps with a narrow job that Haiku does as well: a memory note, matching import columns, sample records. The
 * record lookup and the request review stay on the main model: on Haiku the lookup answered without looking in a
 * third of the eval's cases, and the review flagged gaps in designs that had none.
 */
const FAST_TASKS = new Set(
  (
    process.env.CLAUDE_FAST_TASKS ??
    "assistant-memory,assistant-memory-draft,import-map,design-samples,design-template-samples"
  )
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
);

let client: Anthropic | undefined;
function claude() {
  // Retries are ours (see hedged): the SDK's own would hide a stall behind a quiet second attempt.
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  return client;
}

export function modelFor(task: string) {
  if (FAST_TASKS.has(task)) return { model: FAST_MODEL, location: LOCATION };
  return { model: task.startsWith("design") ? DESIGN_MODEL : CLAUDE_MODEL, location: LOCATION };
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
 * Read-only functions Claude may call while it answers (the assistant's record lookups). Each round's calls run, their
 * results go back, and Claude continues; the last round has tools off so it has to answer.
 */
export type ToolSet = {
  declarations: { name: string; description: string; parametersJsonSchema: unknown }[];
  run: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Rounds of calls before Claude must answer (default 3). */
  maxRounds?: number;
};

/** One piece of the user turn: text, a picture (PNG, JPEG, GIF or WebP) or a PDF, the last two as base64. */
export type PromptPart =
  | { text: string }
  | { image: { mime: string; data: string } }
  | { pdf: { data: string } };

type Input = {
  system: string;
  /** The user turn: plain text, or text plus pictures and PDFs (e.g. a photographed menu). */
  prompt: string | PromptPart[];
  timeoutMs?: number;
  /**
   * Cancels the call when no part of the answer has arrived for this long: a call that stalls midway should be
   * replaced in seconds, while a slow one that keeps streaming is left to finish.
   */
  idleMs?: number;
  /** The same, before the first part, which comes only after the model has thought (defaults to idleMs). */
  firstPartMs?: number;
  /** Called with each part that streams in (generateJsonHedged uses it to tell a stalled call from a slow one). */
  onProgress?: () => void;
  /** Called with the answer so far each time a part streams in (setup draws the design as it's written). */
  onText?: (text: string, attempt: number) => void;
  /** Fixes known harmless slips in the model's JSON before it's checked against the schema. */
  repair?: (json: unknown) => unknown;
  /** How hard Claude thinks before answering (its effort setting). Unset is medium. */
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
   * Longest text, in characters, for values under these property names (e.g. { submitLabel: 40 }). Claude is told
   * the limit in the schema, and a value that runs well past it is stopped as a runaway within a second or two.
   */
  textLimits?: Record<string, number>;
  /** Left from Gemini, which needed literals sent as one-value enums. Claude enforces const, so it changes nothing. */
  enumLiterals?: boolean;
  tools?: ToolSet;
};

/** Keywords Claude's structured output refuses. The answer is parsed with the Zod schema afterwards, which checks them. */
const UNSUPPORTED = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "default",
]);

/** The schema as JSON Schema, with each text limit written into its property. */
function jsonSchema(schema: z.ZodType, textLimits?: Record<string, number>) {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;
  return textLimits ? (withTextLimits(rest, textLimits) as Record<string, unknown>) : rest;
}

/** The same schema in the subset Claude's structured output accepts: every object closed, no size or pattern rules. */
export function strictSchema(node: unknown, key = ""): unknown {
  if (Array.isArray(node)) return node.map((n) => strictSchema(n));
  if (!node || typeof node !== "object") return node;
  // Under "properties" the keys are the answer's own field names (one may be called "format" or "default").
  const named = key === "properties" || key === "$defs";
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(node as Record<string, unknown>)) {
    if (!named && UNSUPPORTED.has(k)) continue;
    out[k] = strictSchema(value, named ? "" : k);
  }
  if (!named && out.type === "object" && typeof out.additionalProperties !== "object")
    out.additionalProperties = false;
  return out;
}

/**
 * Schemas Claude's structured output turned down (too large, or a shape it doesn't take). Those answers are asked
 * for in the instructions instead and checked by the Zod schema alone, as every answer is anyway.
 */
const looseSchemas = new WeakSet<z.ZodType>();
const schemaRefused = (error: unknown) =>
  (error as { status?: number })?.status === 400 &&
  /schema|output_config|format|grammar|additionalProperties|too (complex|large|many)/i.test(String(error));

/**
 * Without structured output Claude leaves out what it has nothing to say for: the plan of a plain answer, an empty
 * list. Those required lists, objects and free-text values are put back empty, which is what leaving them out meant.
 */
export function fillRequired(value: unknown, schema: unknown): unknown {
  const s = schema as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") return value;
  if (Array.isArray(value)) return s.items ? value.map((v) => fillRequired(v, s.items)) : value;
  if (!value || typeof value !== "object" || !s.properties) return value;
  const props = s.properties as Record<string, Record<string, unknown>>;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const name of (s.required as string[] | undefined) ?? []) {
    const prop = props[name];
    if (out[name] !== undefined && out[name] !== null) continue;
    if (prop?.type === "array") out[name] = [];
    else if (prop?.type === "object" && prop.properties) out[name] = {};
    else if (prop?.type === "string" && !prop.enum && prop.const === undefined) out[name] = "";
  }
  for (const [name, prop] of Object.entries(props))
    if (name in out) out[name] = fillRequired(out[name], prop);
  return out;
}

/** Notes the longest text allowed on the string properties (and lists of strings) named in `limits`. */
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

/** Claude's structured output drops maxLength, so each limit is also said in words where Claude reads it. */
function sayTextLimits(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sayTextLimits);
  if (!node || typeof node !== "object") return node;
  const out = Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, sayTextLimits(v)]),
  ) as Record<string, unknown>;
  if (out.type === "string" && typeof out.maxLength === "number")
    out.description = [out.description, `At most ${out.maxLength} characters.`].filter(Boolean).join(" ");
  return out;
}

/**
 * Watches streamed JSON for a runaway: the model sometimes stops closing a string and repeats filler ("Go! Go! Go!",
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
  // Spaces and line breaks in a row between values: an answer that trails off into blank space never ends either.
  let blank = 0;
  return (chunk: string): string | null => {
    for (const ch of chunk) {
      if (!inString && (ch === " " || ch === "\n" || ch === "\t" || ch === "\r")) {
        if (++blank > 400) return "blank space that never ends";
        continue;
      }
      blank = 0;
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

type Usage = { input: number; output: number; thinking: number; cached: number; cacheWrite: number };
/** One round's use so far. input is everything read: fresh, reused from the cache (cached) and saved to it (cacheWrite). */
type RoundUsage = Usage;
/** Usage as the API sends it: what was read when the answer starts, then what has been written so far. */
type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
};

function mergeUsage(prev: RoundUsage | undefined, u: ApiUsage | null | undefined): RoundUsage {
  const cached = u?.cache_read_input_tokens ?? prev?.cached ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? prev?.cacheWrite ?? 0;
  const read = u?.input_tokens == null ? 0 : u.input_tokens + cached + cacheWrite;
  // output_tokens counts thinking too; the log keeps the two apart.
  const thinking = u?.output_tokens_details?.thinking_tokens ?? prev?.thinking ?? 0;
  const written = u?.output_tokens ?? 0;
  return {
    input: read || prev?.input || 0,
    cached,
    cacheWrite,
    output: Math.max(written - thinking, 0),
    thinking,
  };
}

/** What one call has used so far, kept outside the call so a call that throws midway is still counted. */
type Meter = {
  usage: Usage;
  rounds: number;
  /** The round being streamed, until it completes. */
  round?: { promptChars: number; text: string; usage?: RoundUsage; started: boolean };
};

/** A content block, as streamed from Claude or sent to it. */
type Block = { type: string; [key: string]: unknown };
type Message = { role: "user" | "assistant"; content: Block[] };

function toBlock(part: PromptPart): Block {
  if ("text" in part) return { type: "text", text: part.text };
  if ("image" in part)
    return {
      type: "image",
      source: { type: "base64", media_type: part.image.mime, data: part.image.data },
    };
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.pdf.data } };
}

/** Characters of text sent in a round (the instructions, every text block and lookup result), for estimating its tokens. */
function promptChars(system: string, messages: Message[]): number {
  let n = system.length;
  for (const m of messages)
    for (const b of m.content)
      n +=
        typeof b.text === "string"
          ? b.text.length
          : b.type === "tool_result" || b.type === "tool_use"
            ? JSON.stringify(b).length
            : 0;
  return n;
}

/** About four characters a token, for text Claude never reported usage for. */
const roughTokens = (chars: number) => Math.ceil(chars / 4);

/** The JSON in an answer. Without structured output Claude may fence it or add a line around it. */
function parseAnswer(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
}

/**
 * Asks Claude for JSON that matches `schema`, then parses it with the same schema. Every call is logged to ai_call,
 * whatever its outcome: a twin cancelled because another answered, a loop that was stopped and a failure all used
 * tokens, and those are counted too (estimated from the text when Claude didn't get to report them).
 */
export async function generateJson<T>(schema: z.ZodType<T>, input: Input): Promise<GenerateResult<T>> {
  const started = Date.now();
  const { model, location } = modelFor(input.task);
  const meter: Meter = {
    usage: { input: 0, output: 0, thinking: 0, cached: 0, cacheWrite: 0 },
    rounds: 0,
  };
  const result = await generateJsonOnce(schema, input, meter);
  const reason = result.ok ? "ok" : (result.reason ?? "error");
  let estimated = false;
  const round = meter.round;
  if (round) {
    // The call stopped midway through a round (cancelled, stalled, timed out, failed). Claude bills what it read and
    // wrote; when it didn't report the numbers, estimate them, but only if it had started on the request.
    const reported = round.usage;
    const stoppedByUs = ["cancelled", "stalled", "timeout", "runaway"].includes(reason);
    if (reported?.input) {
      meter.usage.input += reported.input;
      meter.usage.cached += reported.cached;
      meter.usage.cacheWrite += reported.cacheWrite;
      meter.usage.thinking += reported.thinking;
      // The count sent when the answer starts is a token or two; what was written since is estimated from the text.
      const written = roughTokens(round.text.length);
      meter.usage.output += Math.max(reported.output, written);
      estimated = written > reported.output;
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
  const { model: MODEL } = modelFor(input.task);
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
  let refused = false;
  let text = "";
  const messages: Message[] = [
    {
      role: "user",
      content:
        typeof input.prompt === "string" ? [{ type: "text", text: input.prompt }] : input.prompt.map(toBlock),
    },
  ];
  const full = sayTextLimits(jsonSchema(schema, input.textLimits));
  const effort = (input.thinking ?? "MEDIUM").toLowerCase();
  // Thinking counts toward max_tokens, so the answer's own cap gets room on top for it.
  const maxTokens = (input.maxOutputTokens ?? 16_000) + (effort === "low" ? 2_000 : 6_000);
  const usage = meter.usage;
  let calls = 0;
  try {
    const rounds = input.tools ? (input.tools.maxRounds ?? 3) + 1 : 1;
    for (let round = 0; round < rounds; round++) {
      const last = round === rounds - 1;
      quietFor(input.firstPartMs ?? input.idleMs);
      const enforced = !looseSchemas.has(schema);
      const system = enforced
        ? input.system
        : `${input.system}\n\nAnswer with one JSON object and nothing else: no code fence, no text before or after it. It must match this JSON Schema, with every required property present (an empty list, object or text where there is nothing to say):\n${JSON.stringify(full)}`;
      const streaming: NonNullable<Meter["round"]> = {
        promptChars: promptChars(system, messages),
        text: "",
        started: false,
      };
      meter.round = streaming;
      const params = {
        model: MODEL,
        max_tokens: maxTokens,
        stream: true,
        // The instructions (and the lookups' declarations before them) are the same from call to call: Claude keeps
        // them for five minutes and rereads them at a tenth of the price.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        thinking: { type: "adaptive" },
        output_config: {
          effort,
          ...(enforced ? { format: { type: "json_schema", schema: strictSchema(full) } } : {}),
        },
        ...(input.tools
          ? {
              tools: input.tools.declarations.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parametersJsonSchema,
              })),
              ...(last ? { tool_choice: { type: "none" } } : {}),
            }
          : {}),
      } as unknown as Anthropic.MessageCreateParamsStreaming;
      let stream: AsyncIterable<Anthropic.RawMessageStreamEvent>;
      const signal = AbortSignal.any(signals);
      try {
        stream = await claude().messages.create(params, { signal });
      } catch (error) {
        if (!enforced || !schemaRefused(error)) throw error;
        // Asked for in words from here on (and for every later call with this schema).
        looseSchemas.add(schema);
        console.warn(
          JSON.stringify({
            event: "claude_schema_refused",
            task: input.task,
            model: MODEL,
            message: String(error).slice(0, 300),
          }),
        );
        meter.round = undefined;
        round--;
        continue;
      }
      const watch = runawayWatcher(input.maxStringChars, input.textLimits);
      // Blocks are kept as Claude sent them: its thinking carries a signature it needs back on the next round.
      const blocks: Block[] = [];
      const args: string[] = [];
      let roundUsage: RoundUsage | undefined;
      let stopReason: string | null = null;
      text = "";
      for await (const event of stream) {
        streaming.started = true;
        let part = "";
        if (event.type === "message_start") roundUsage = mergeUsage(undefined, event.message.usage);
        else if (event.type === "message_delta") {
          roundUsage = mergeUsage(roundUsage, event.usage);
          stopReason = event.delta.stop_reason ?? stopReason;
        } else if (event.type === "content_block_start")
          blocks[event.index] = { ...(event.content_block as unknown as Block) };
        else if (event.type === "content_block_delta") {
          firstMs ??= Date.now() - started;
          quietFor(input.idleMs);
          input.onProgress?.();
          const block = blocks[event.index];
          const delta = event.delta as unknown as { type: string; [key: string]: string };
          if (!block) continue;
          if (delta.type === "text_delta") {
            part = delta.text;
            block.text = `${block.text ?? ""}${part}`;
          } else if (delta.type === "thinking_delta")
            block.thinking = `${block.thinking ?? ""}${delta.thinking}`;
          else if (delta.type === "signature_delta") block.signature = delta.signature;
          else if (delta.type === "input_json_delta")
            args[event.index] = `${args[event.index] ?? ""}${delta.partial_json}`;
        }
        streaming.usage = roundUsage;
        if (!part) continue;
        text += part;
        streaming.text = text;
        input.onText?.(text, 0);
        runaway = watch(part);
        if (runaway) {
          stop.abort();
          break;
        }
      }
      quietFor(undefined);
      // The SDK ends a stopped stream quietly: a timeout, stall or cancelled twin must not pass for a finished answer.
      if (signal.aborted && !runaway) throw new Error("Request was aborted.");
      usage.input += roundUsage?.input ?? 0;
      usage.output += roundUsage?.output ?? 0;
      usage.thinking += roundUsage?.thinking ?? 0;
      usage.cached += roundUsage?.cached ?? 0;
      usage.cacheWrite += roundUsage?.cacheWrite ?? 0;
      // A runaway's answer was cut short before Claude reported what it wrote: count it from the text.
      if (runaway) usage.output += Math.max(roughTokens(text.length) - (roundUsage?.output ?? 0), 0);
      meter.rounds++;
      meter.round = undefined;
      if (stopReason === "refusal") refused = true;
      const wanted = blocks.filter((b) => b?.type === "tool_use");
      if (runaway || refused || !wanted.length || !input.tools) break;
      calls += wanted.length;
      const tools = input.tools;
      for (const [i, b] of blocks.entries())
        if (b?.type === "tool_use") {
          try {
            b.input = args[i] ? JSON.parse(args[i]) : {};
          } catch {
            b.input = {};
          }
        }
      const results = await Promise.all(
        wanted.map(async (b) => {
          const output = await tools.run(String(b.name ?? ""), (b.input ?? {}) as Record<string, unknown>);
          return { type: "tool_result", tool_use_id: b.id, content: fitToolOutput(output, 12_000) } as Block;
        }),
      );
      messages.push(
        { role: "assistant", content: blocks.filter(Boolean) },
        { role: "user", content: results },
      );
    }
    const ms = Date.now() - started;
    if (runaway) {
      console.warn(
        JSON.stringify({
          event: "claude_runaway",
          task: input.task,
          model: MODEL,
          ms,
          why: runaway,
          chars: text.length,
          // The end of what came back, to tell a real runaway from an answer that's just long.
          tail: text.slice(-160),
        }),
      );
      return { ok: false, error: "Claude got stuck repeating itself.", retryable: true, reason: "runaway" };
    }
    const tokens = usage;
    console.info(
      JSON.stringify({
        event: "claude",
        task: input.task,
        model: MODEL,
        ms,
        ...(firstMs === undefined ? {} : { firstMs }),
        ...tokens,
        ...(input.tools ? { calls } : {}),
      }),
    );
    if (refused) return { ok: false, error: "Claude can't help with that request.", retryable: false };
    if (!text)
      return { ok: false, error: "Claude returned an empty answer.", retryable: true, reason: "empty" };
    let json: unknown;
    try {
      json = parseAnswer(text);
    } catch {
      return { ok: false, error: "Claude returned malformed JSON.", retryable: true, reason: "malformed" };
    }
    const cleaned = looseSchemas.has(schema) ? fillRequired(withoutNulls(json), full) : withoutNulls(json);
    const parsed = schema.safeParse(input.repair ? input.repair(cleaned) : cleaned);
    if (!parsed.success) {
      console.warn(
        JSON.stringify({
          event: "claude_schema_mismatch",
          task: input.task,
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
          // The value at the first failing path, so the slip can be fixed in a repair or the prompt.
          failing: (JSON.stringify(valueAt(cleaned, parsed.error.issues[0]?.path ?? [])) ?? "missing").slice(
            0,
            1500,
          ),
        }),
      );
      return {
        ok: false,
        // The details are in the log above; people only need to know it didn't come together.
        error: "Claude's answer came back incomplete. Try again.",
        retryable: true,
        reason: "schema",
      };
    }
    return { ok: true, data: parsed.data, model: MODEL, ms, tokens };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number })?.status;
    if (input.signal?.aborted)
      return { ok: false, error: "Cancelled.", retryable: false, reason: "cancelled" };
    if (runaway)
      return { ok: false, error: "Claude got stuck repeating itself.", retryable: true, reason: "runaway" };
    if (stalled) {
      console.warn(
        JSON.stringify({
          event: "claude_stalled",
          task: input.task,
          model: MODEL,
          ms: Date.now() - started,
          firstMs,
          chars: text.length,
        }),
      );
      return { ok: false, error: "Claude took too long to answer.", retryable: true, reason: "stalled" };
    }
    console.error(
      JSON.stringify({ event: "claude_error", task: input.task, model: MODEL, message, chars: text.length }),
    );
    const timedOut = /abort|timeout|timed out/i.test(message);
    // Over the rate limit: retried, but only after a pause (see hedged), since asking again at once only adds to the load.
    const rateLimited = status === 429 || /\b429\b|rate_limit|Too Many Requests/i.test(message);
    // A dropped connection ("terminated" is undici's word for a response cut off mid-stream), a reset socket or a
    // busy API (529, overloaded) answers fine on the next try. A bad request (400) does not, so it stays final.
    const transient =
      (status !== undefined && status >= 500) ||
      /terminated|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket|fetch failed|other side closed|Connection error|\b(429|500|502|503|504|529)\b|overloaded|api_error/i.test(
        message,
      );
    return {
      ok: false,
      error: timedOut
        ? "Claude took too long to answer."
        : rateLimited
          ? "Claude is busy right now. Try again in a minute."
          : "Claude is unavailable right now.",
      retryable: timedOut || transient || rateLimited,
      reason: timedOut ? "timeout" : rateLimited ? "rate-limited" : "error",
      ...(rateLimited ? { rateLimited: true } : {}),
    };
  } finally {
    clearTimeout(idleTimer);
  }
}

/**
 * A lookup result as JSON of at most `max` characters. Cutting the text instead left the model half a record and broken
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

/** The model sometimes writes null for an optional field it means to leave out; drop those keys before validating. */
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
 * generateJson with hedging: a call now and then stalls outright, so if the first call hasn't answered after
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
        console.info(JSON.stringify({ event: "claude_hedge", task: input.task, attempt })),
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
