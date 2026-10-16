import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam, MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import type { Part } from "@google/genai";
import { Storage } from "@google-cloud/storage";
import type { z } from "zod";
import {
  type FailReason,
  fitToolOutput,
  type GenerateInput,
  type GenerateResult,
  type Meter,
  responseSchema,
  roughTokens,
  runawayWatcher,
  valueAt,
  withoutNulls,
} from "./gemini";

/**
 * Claude for the test router (see route.ts): the same contract as Gemini's generateJson, so callers don't change.
 * The answer is a forced call to an "answer" tool whose input schema is the task's schema, which Claude supports on
 * every model and endpoint; the assistant's record lookups are offered as tools alongside it. Streaming, the runaway
 * and stall checks, retries and the usage log work as they do for Gemini. Claude's extended thinking can't be used
 * with a forced tool, so the thinking level is ignored here.
 */
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "everyops-prod";
const ANSWER = "answer";

type Client = Pick<Anthropic, "messages">;
const clients = new Map<string, Client>();
function claude(location: string): Client {
  let client = clients.get(location);
  if (!client) {
    client =
      location === "anthropic"
        ? new Anthropic()
        : (new AnthropicVertex({ projectId: PROJECT, region: location }) as unknown as Client);
    clients.set(location, client);
  }
  return client;
}

let storage: Storage | undefined;
/** A file the attachments code passes as a Cloud Storage link (gs://bucket/path), as base64. */
async function readLink(uri: string): Promise<string> {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error(`Can't read ${uri}`);
  storage ??= new Storage();
  const [bytes] = await storage.bucket(match[1]).file(match[2]).download();
  return bytes.toString("base64");
}

function media(mime: string, data: string): ContentBlockParam {
  return mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data,
        },
      };
}

/** Gemini parts as Claude content (route.ts sends only prompts Claude can read). */
export async function toClaudeContent(prompt: string | Part[]): Promise<ContentBlockParam[]> {
  if (typeof prompt === "string") return [{ type: "text", text: prompt || " " }];
  const out: ContentBlockParam[] = [];
  for (const p of prompt) {
    if (typeof p.text === "string") {
      if (p.text) out.push({ type: "text", text: p.text });
    } else if (p.inlineData?.data && p.inlineData.mimeType)
      out.push(media(p.inlineData.mimeType, p.inlineData.data));
    else if (p.fileData?.fileUri && p.fileData.mimeType)
      out.push(media(p.fileData.mimeType, await readLink(p.fileData.fileUri)));
  }
  return out.length ? out : [{ type: "text", text: " " }];
}

const charsOf = (system: string, messages: MessageParam[]) =>
  system.length +
  messages.reduce(
    (n, m) =>
      n +
      (typeof m.content === "string"
        ? m.content.length
        : m.content.reduce((k, b) => k + (b.type === "text" ? b.text.length : JSON.stringify(b).length), 0)),
    0,
  );

type Block = { id: string; name: string; json: string };

export async function generateClaudeOnce<T>(
  schema: z.ZodType<T>,
  input: GenerateInput,
  meter: Meter,
  model: string,
  location: string,
): Promise<GenerateResult<T>> {
  const started = Date.now();
  const stop = new AbortController();
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
  let calls = 0;
  const usage = meter.usage;
  const answerTool: Tool = {
    name: ANSWER,
    description: "Give your answer: call this with JSON that fits its schema.",
    input_schema: responseSchema(schema, input.enumLiterals, input.textLimits) as Tool["input_schema"],
  };
  const lookups: Tool[] = (input.tools?.declarations ?? []).map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parametersJsonSchema as Tool["input_schema"],
  }));
  const system = [
    { type: "text" as const, text: input.system || " ", cache_control: { type: "ephemeral" as const } },
  ];
  const messages: MessageParam[] = [{ role: "user", content: await toClaudeContent(input.prompt) }];
  try {
    const rounds = input.tools ? (input.tools.maxRounds ?? 3) + 1 : 1;
    for (let round = 0; round < rounds; round++) {
      const last = round === rounds - 1;
      quietFor(input.firstPartMs ?? input.idleMs);
      const streaming: NonNullable<Meter["round"]> = {
        promptChars: charsOf(input.system, messages),
        text: "",
        started: false,
      };
      meter.round = streaming;
      const stream = await claude(location).messages.create(
        {
          model: location === "anthropic" ? model.split("@")[0] : model,
          max_tokens: input.maxOutputTokens ?? 8192,
          system,
          messages,
          tools: [...lookups, answerTool],
          // Lookups first if it wants them; the last round (or a call without lookups) must answer.
          tool_choice: last || !lookups.length ? { type: "tool", name: ANSWER } : { type: "any" },
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          stream: true,
        },
        { signal: AbortSignal.any(signals) },
      );
      const watch = runawayWatcher(input.maxStringChars, input.textLimits);
      const blocks = new Map<number, Block>();
      const got = { input: 0, cached: 0, output: 0 };
      text = "";
      for await (const event of stream) {
        firstMs ??= Date.now() - started;
        quietFor(input.idleMs);
        input.onProgress?.();
        if (event.type === "message_start") {
          const u = event.message.usage;
          got.cached = u.cache_read_input_tokens ?? 0;
          // Claude counts cache reads and writes apart from input; the log's input includes them, as Gemini's does.
          got.input = u.input_tokens + got.cached + (u.cache_creation_input_tokens ?? 0);
          got.output = u.output_tokens ?? 0;
        } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          blocks.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: "" });
        } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          const block = blocks.get(event.index);
          if (!block) continue;
          block.json += event.delta.partial_json;
          if (block.name === ANSWER) {
            text += event.delta.partial_json;
            if (event.delta.partial_json) input.onText?.(text, 0);
            runaway = watch(event.delta.partial_json);
          }
        } else if (event.type === "message_delta") {
          got.output = event.usage.output_tokens;
        }
        streaming.started = true;
        streaming.text = text;
        streaming.usage = {
          promptTokenCount: got.input,
          cachedContentTokenCount: got.cached,
          candidatesTokenCount: got.output,
        };
        if (runaway) {
          stop.abort();
          break;
        }
      }
      quietFor(undefined);
      usage.input += got.input;
      usage.cached += got.cached;
      usage.output += got.output || (runaway ? roughTokens(text.length) : 0);
      meter.rounds++;
      meter.round = undefined;
      const all = [...blocks.values()];
      const wanted = all.filter((b) => b.name !== ANSWER);
      if (runaway || all.some((b) => b.name === ANSWER) || !wanted.length || !input.tools) break;
      calls += wanted.length;
      const tools = input.tools;
      const parsed = wanted.map((b) => ({
        ...b,
        args: JSON.parse(b.json || "{}") as Record<string, unknown>,
      }));
      const results = await Promise.all(parsed.map((b) => tools.run(b.name, b.args)));
      messages.push(
        {
          role: "assistant",
          content: parsed.map((b) => ({ type: "tool_use" as const, id: b.id, name: b.name, input: b.args })),
        },
        {
          role: "user",
          content: parsed.map((b, i) => ({
            type: "tool_result" as const,
            tool_use_id: b.id,
            content: fitToolOutput(results[i], 12_000),
          })),
        },
      );
    }
    const ms = Date.now() - started;
    if (runaway) {
      console.warn(
        JSON.stringify({
          event: "claude_runaway",
          task: input.task,
          model,
          ms,
          why: runaway,
          tail: text.slice(-160),
        }),
      );
      return {
        ok: false,
        error: "The model got stuck repeating itself.",
        retryable: true,
        reason: "runaway",
      };
    }
    console.info(
      JSON.stringify({
        event: "claude",
        task: input.task,
        model,
        ms,
        ...(firstMs === undefined ? {} : { firstMs }),
        ...usage,
        ...(input.tools ? { calls } : {}),
      }),
    );
    if (!text)
      return { ok: false, error: "The model returned an empty answer.", retryable: true, reason: "empty" };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: "The model returned malformed JSON.", retryable: true, reason: "malformed" };
    }
    const cleaned = withoutNulls(json);
    const parsed = schema.safeParse(input.repair ? input.repair(cleaned) : cleaned);
    if (!parsed.success) {
      console.warn(
        JSON.stringify({
          event: "claude_schema_mismatch",
          task: input.task,
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
          failing: JSON.stringify(valueAt(cleaned, parsed.error.issues[0]?.path ?? [])).slice(0, 1500),
        }),
      );
      return {
        ok: false,
        error: "The answer came back incomplete. Try again.",
        retryable: true,
        reason: "schema",
      };
    }
    return { ok: true, data: parsed.data, model, ms, tokens: usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status;
    if (input.signal?.aborted)
      return { ok: false, error: "Cancelled.", retryable: false, reason: "cancelled" };
    if (runaway)
      return {
        ok: false,
        error: "The model got stuck repeating itself.",
        retryable: true,
        reason: "runaway",
      };
    if (stalled) {
      console.warn(
        JSON.stringify({ event: "claude_stalled", task: input.task, model, ms: Date.now() - started }),
      );
      return { ok: false, error: "The model took too long to answer.", retryable: true, reason: "stalled" };
    }
    console.error(JSON.stringify({ event: "claude_error", task: input.task, model, status, message }));
    const timedOut = /abort|timeout/i.test(message);
    const rateLimited = status === 429 || /\b429\b|RESOURCE_EXHAUSTED|rate limit/i.test(message);
    // 529 is Anthropic's "overloaded"; 5xx and dropped connections answer fine on the next try.
    const transient =
      (status !== undefined && status >= 500) ||
      /terminated|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket|fetch failed|overloaded/i.test(message);
    const reason: FailReason = timedOut ? "timeout" : rateLimited ? "rate-limited" : "error";
    return {
      ok: false,
      error: timedOut
        ? "The model took too long to answer."
        : rateLimited
          ? "The model is busy right now. Try again in a minute."
          : "The model is unavailable right now.",
      retryable: timedOut || transient || rateLimited,
      ...(rateLimited ? { rateLimited: true } : {}),
      reason,
    };
  } finally {
    clearTimeout(idleTimer);
  }
}
