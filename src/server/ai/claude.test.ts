import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { claudeCanTake, claudeLocation, claudeModelFor, providerFor } from "./route";

vi.mock("server-only", () => ({}));
const recordAiCall = vi.fn();
vi.mock("./usage", () => ({ recordAiCall, countTokens: vi.fn() }));

/** What each fake Claude call streams back (one list of events per call), and the requests it received. */
let replies: unknown[][] = [];
const requests: Record<string, unknown>[] = [];
vi.mock("@anthropic-ai/vertex-sdk", () => ({
  AnthropicVertex: class {
    messages = {
      create: async (body: Record<string, unknown>) => {
        requests.push(structuredClone(body));
        const events = replies.shift() ?? [];
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    };
  },
}));
// Gemini answers too, so a call that stays with Gemini is visible.
let geminiCalls = 0;
vi.mock("@google/genai", async (original) => ({
  ...(await original<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = {
      generateContentStream: async () => {
        geminiCalls++;
        return (async function* () {
          yield {
            candidates: [{ content: { parts: [{ text: '{"n":7}' }] } }],
            usageMetadata: { promptTokenCount: 5 },
          };
        })();
      },
    };
  },
}));

const { generateJson } = await import("./gemini");

/** A streamed Claude answer: the "answer" tool's JSON in pieces, with usage as Claude reports it. */
function answer(
  json: string,
  usage = { input_tokens: 300, cache_read_input_tokens: 900, output_tokens: 12 },
) {
  const half = Math.floor(json.length / 2);
  return [
    { type: "message_start", message: { usage: { ...usage, output_tokens: 1 } } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "t1", name: "answer", input: {} },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: json.slice(0, half) },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: json.slice(half) },
    },
    { type: "message_delta", usage: { output_tokens: usage.output_tokens } },
  ];
}

const schema = z.object({ n: z.number() });
const input = { system: "Answer with a number.", prompt: "Seven?", task: "assistant", timeoutMs: 30_000 };
const saved = { ...process.env };

beforeEach(() => {
  replies = [];
  requests.length = 0;
  geminiCalls = 0;
  recordAiCall.mockClear();
  process.env.AI_PROVIDER = "claude";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("the provider router", () => {
  it("keeps Gemini unless told otherwise, and lets single tasks switch", () => {
    expect(providerFor("assistant", {})).toBe("gemini");
    expect(providerFor("assistant", { AI_PROVIDER: "claude" })).toBe("claude");
    const env = { AI_PROVIDER_TASKS: "assistant*=claude, design=gemini" };
    expect(providerFor("assistant-lookup", env)).toBe("claude");
    expect(providerFor("design", { ...env, AI_PROVIDER: "claude" })).toBe("gemini");
    expect(providerFor("interview", env)).toBe("gemini");
  });

  it("uses Haiku by default, a bigger model for design when set, and Anthropic's API when there's a key", () => {
    expect(claudeModelFor("assistant", {})).toBe("claude-haiku-4-5@20251001");
    const env = { CLAUDE_DESIGN_MODEL: "claude-sonnet-4-5@20250929" };
    expect(claudeModelFor("design-fix", env)).toBe("claude-sonnet-4-5@20250929");
    expect(claudeModelFor("interview", env)).toBe("claude-haiku-4-5@20251001");
    expect(claudeLocation({})).toBe("global");
    expect(claudeLocation({ ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
  });

  it("leaves audio with Gemini and takes photos and PDFs", () => {
    expect(
      claudeCanTake([{ inlineData: { mimeType: "audio/webm", data: "AA" } }, { text: "Transcribe" }]),
    ).toBe(false);
    expect(
      claudeCanTake([
        { text: "Menu:" },
        { fileData: { fileUri: "gs://b/menu.jpg", mimeType: "image/jpeg" } },
      ]),
    ).toBe(true);
    expect(claudeCanTake([{ fileData: { fileUri: "gs://b/a.pdf", mimeType: "application/pdf" } }])).toBe(
      true,
    );
  });
});

describe("Claude through generateJson", () => {
  it("answers through the forced answer tool and logs the call with Claude's usage", async () => {
    replies = [answer('{"n":7}')];
    const seen: string[] = [];
    const result = await generateJson(schema, { ...input, onText: (t) => seen.push(t) });
    expect(result).toMatchObject({ ok: true, data: { n: 7 } });
    expect(seen.at(-1)).toBe('{"n":7}');
    expect(requests[0]).toMatchObject({
      model: "claude-haiku-4-5@20251001",
      tool_choice: { type: "tool", name: "answer" },
      system: [{ type: "text", text: "Answer with a number.", cache_control: { type: "ephemeral" } }],
    });
    expect(geminiCalls).toBe(0);
    expect(recordAiCall.mock.calls[0][0]).toMatchObject({
      model: "claude-haiku-4-5",
      location: "global",
      outcome: "ok",
      // Cache reads count as input, as Gemini's do, and are also shown as cached.
      tokens: { input: 1200, cached: 900, output: 12, thinking: 0 },
    });
  });

  it("runs the record lookups Claude asks for, then takes its answer", async () => {
    const run = vi.fn(async () => ({ rows: [{ court: "Court 1", unpaid: 3 }] }));
    replies = [
      [
        { type: "message_start", message: { usage: { input_tokens: 400, output_tokens: 1 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "l1", name: "find_records", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"entity":"booking"}' },
        },
        { type: "message_delta", usage: { output_tokens: 20 } },
      ],
      answer('{"n":3}', { input_tokens: 500, cache_read_input_tokens: 0, output_tokens: 8 }),
    ];
    const result = await generateJson(schema, {
      ...input,
      tools: {
        declarations: [
          { name: "find_records", description: "Find records", parametersJsonSchema: { type: "object" } },
        ],
        run,
      },
    });
    expect(result).toMatchObject({ ok: true, data: { n: 3 } });
    expect(run).toHaveBeenCalledWith("find_records", { entity: "booking" });
    // The first round may look things up; the lookup's result goes back with the second.
    expect(requests[0]).toMatchObject({ tool_choice: { type: "any" } });
    const second = requests[1] as { messages: { role: string; content: { type: string }[] }[] };
    expect(second.messages.map((m) => m.content[0]?.type)).toEqual(["text", "tool_use", "tool_result"]);
    expect(recordAiCall.mock.calls[0][0]).toMatchObject({ rounds: 2, tokens: { input: 900, output: 28 } });
  });

  it("keeps a voice note with Gemini even when Claude is the provider", async () => {
    const result = await generateJson(schema, {
      ...input,
      task: "transcribe",
      prompt: [
        { inlineData: { mimeType: "audio/webm", data: "AAAA" } },
        { text: "Transcribe this voice message." },
      ],
    });
    expect(result).toMatchObject({ ok: true, data: { n: 7 } });
    expect(geminiCalls).toBe(1);
    expect(requests).toHaveLength(0);
    expect(recordAiCall.mock.calls[0][0]).toMatchObject({ model: "gemini-3.7-flash" });
  });
});
