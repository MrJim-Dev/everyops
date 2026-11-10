import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { costMicros } from "@/lib/ai-usage";

vi.mock("server-only", () => ({}));
const recordAiCall = vi.fn();
const countTokens = vi.fn();
vi.mock("./usage", () => ({ recordAiCall, countTokens }));

/** What the API reports: fresh input, input reused from and saved to the cache, and output (thinking included). */
type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens: number };
};
/**
 * One fake Claude call: what it read (sent when the answer starts), parts after a delay, and what it wrote in all
 * (sent when the answer ends); or an error thrown up front.
 */
type Script = { start?: Usage; parts: [number, string][]; end?: Usage } | { fail: string; status?: number };
let scripts: Script[] = [];

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (_params: unknown, { signal }: { signal: AbortSignal }) => {
        const script = scripts.shift() ?? { fail: "no script" };
        if ("fail" in script) throw Object.assign(new Error(script.fail), { status: script.status });
        return (async function* () {
          yield { type: "message_start", message: { usage: script.start ?? {} } };
          yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
          for (const [ms, text] of script.parts) {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, ms);
              signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("Request was aborted."));
              });
            });
            yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
          }
          yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: script.end ?? {} };
        })();
      },
    };
  },
}));

const { generateJson, generateJsonHedged } = await import("./claude");
const schema = z.object({ n: z.number() });
const input = { system: "Answer with a number.", prompt: "One?", task: "assistant", timeoutMs: 120_000 };

beforeEach(() => {
  recordAiCall.mockClear();
  countTokens.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("the AI use log", () => {
  it("logs an answered call once, with the tokens Claude reported", async () => {
    scripts = [
      {
        // 300 fresh, 800 reread from the cache and 100 saved to it: 1,200 read in all.
        start: { input_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 },
        parts: [[10, '{"n":1}']],
        // Claude counts thinking as output: 46 written, 40 of them thought.
        end: { output_tokens: 46, output_tokens_details: { thinking_tokens: 40 } },
      },
    ];
    expect(await generateJson(schema, input)).toMatchObject({ ok: true, data: { n: 1 } });
    expect(recordAiCall).toHaveBeenCalledTimes(1);
    expect(recordAiCall.mock.calls[0][0]).toMatchObject({
      task: "assistant",
      outcome: "ok",
      attempt: 0,
      rounds: 1,
      estimated: false,
      tokens: { input: 1200, cached: 800, cacheWrite: 100, output: 6, thinking: 40 },
    });
    // The monthly budget counts what was read, written and thought.
    expect(countTokens).toHaveBeenCalledWith(1246);
  });

  it("logs the duplicate that lost the race as cancelled, with what it had used", async () => {
    vi.useFakeTimers();
    scripts = [
      // The first call starts answering, then goes quiet; its twin starts after 5 s and answers.
      {
        start: { input_tokens: 1000, output_tokens: 1 },
        parts: [
          [1_000, '{"n":'],
          [60_000, "1}"],
        ],
      },
      {
        start: { input_tokens: 1000, output_tokens: 1 },
        parts: [[1_000, '{"n":2}']],
        end: { output_tokens: 6 },
      },
    ];
    const result = generateJsonHedged(schema, input, { hedgeMs: 5_000, attempts: 2 });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await result).toMatchObject({ ok: true, data: { n: 2 } });
    await vi.advanceTimersByTimeAsync(10);
    const logged = recordAiCall.mock.calls.map(([c]) => c);
    expect(logged).toHaveLength(2);
    expect(logged.find((c) => c.attempt === 1)).toMatchObject({
      outcome: "ok",
      tokens: { input: 1000, output: 6 },
    });
    // Claude had read the prompt and written five characters: about two tokens, marked as estimated.
    expect(logged.find((c) => c.attempt === 0)).toMatchObject({
      outcome: "cancelled",
      estimated: true,
      tokens: { input: 1000, output: 2 },
    });
  });

  it("logs a call refused before Claude started on it, with nothing to pay for", async () => {
    scripts = [{ fail: '429 {"type":"error","error":{"type":"rate_limit_error"}}', status: 429 }];
    expect(await generateJson(schema, input)).toMatchObject({ ok: false, rateLimited: true });
    expect(recordAiCall.mock.calls[0][0]).toMatchObject({
      outcome: "rate-limited",
      estimated: false,
      tokens: { input: 0, output: 0, thinking: 0, cached: 0 },
    });
  });
});

describe("estimated cost", () => {
  it("bills thinking as output, cached input at a tenth, saving to the cache a quarter more", () => {
    const claude = {
      input: 1_000_000,
      cached: 500_000,
      cacheWrite: 200_000,
      output: 100_000,
      thinking: 100_000,
    };
    // 0.3M × $2 + 0.5M × $0.20 + 0.2M × $2.50 + 0.2M × $10 = $3.20.
    expect(costMicros("claude-sonnet-5-5", "global", claude)).toBe(3_200_000);
    // A model without a rate is priced like the default one, never at zero.
    expect(costMicros("claude-next", "global", claude)).toBe(3_200_000);
  });

  it("still prices Gemini calls (sound, video and the log from before Claude), regional ones 10% more", () => {
    const t = { input: 1_000_000, cached: 500_000, output: 100_000, thinking: 100_000 };
    // 0.5M × $1.50 + 0.5M × $0.15 + 0.2M × $9 = $2.625 on the global endpoint.
    expect(costMicros("gemini-3.5-flash", "global", t)).toBe(2_625_000);
    expect(costMicros("gemini-3.5-flash", "asia-southeast1", t)).toBe(2_887_500);
    // A model without a rate is priced like the default one, never at zero.
    expect(costMicros("gemini-9-flash", "global", t)).toBeGreaterThan(0);
  });
});
