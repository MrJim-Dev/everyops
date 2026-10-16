import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { costMicros } from "@/lib/ai-usage";

vi.mock("server-only", () => ({}));
const recordAiCall = vi.fn();
const countTokens = vi.fn();
vi.mock("./usage", () => ({ recordAiCall, countTokens }));

type Usage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
};
/** One fake Vertex call: parts after a delay (with usage, as Vertex sends it), or an error thrown up front. */
type Script = { parts: [number, string, Usage?][] } | { fail: string };
let scripts: Script[] = [];

vi.mock("@google/genai", async (original) => ({
  ...(await original<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = {
      generateContentStream: async ({ config }: { config: { abortSignal: AbortSignal } }) => {
        const script = scripts.shift() ?? { fail: "no script" };
        if ("fail" in script) throw new Error(script.fail);
        return (async function* () {
          for (const [ms, text, usageMetadata] of script.parts) {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, ms);
              config.abortSignal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("This operation was aborted"));
              });
            });
            yield {
              candidates: [{ content: { parts: [{ text }] } }],
              ...(usageMetadata ? { usageMetadata } : {}),
            };
          }
        })();
      },
    };
  },
}));

const { generateJson, generateJsonHedged } = await import("./gemini");
const schema = z.object({ n: z.number() });
const input = { system: "Answer with a number.", prompt: "One?", task: "assistant", timeoutMs: 120_000 };

beforeEach(() => {
  recordAiCall.mockClear();
  countTokens.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("the AI use log", () => {
  it("logs an answered call once, with the tokens Gemini reported", async () => {
    scripts = [
      {
        parts: [
          [
            10,
            '{"n":1}',
            {
              promptTokenCount: 1200,
              cachedContentTokenCount: 800,
              candidatesTokenCount: 6,
              thoughtsTokenCount: 40,
            },
          ],
        ],
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
      tokens: { input: 1200, cached: 800, output: 6, thinking: 40 },
    });
    // The monthly budget counts what was read, written and thought.
    expect(countTokens).toHaveBeenCalledWith(1246);
  });

  it("logs the duplicate that lost the race as cancelled, with what it had used", async () => {
    vi.useFakeTimers();
    scripts = [
      // The first call starts answering, then goes quiet; its twin starts after 5 s and answers.
      {
        parts: [
          [1_000, '{"n":', { promptTokenCount: 1000 }],
          [60_000, "1}"],
        ],
      },
      { parts: [[1_000, '{"n":2}', { promptTokenCount: 1000, candidatesTokenCount: 6 }]] },
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
    // Gemini had read the prompt and written five characters: about two tokens, marked as estimated.
    expect(logged.find((c) => c.attempt === 0)).toMatchObject({
      outcome: "cancelled",
      estimated: true,
      tokens: { input: 1000, output: 2 },
    });
  });

  it("logs a call refused before Gemini started on it, with nothing to pay for", async () => {
    scripts = [{ fail: "429 RESOURCE_EXHAUSTED" }];
    expect(await generateJson(schema, input)).toMatchObject({ ok: false, rateLimited: true });
    expect(recordAiCall.mock.calls[0][0]).toMatchObject({
      outcome: "rate-limited",
      estimated: false,
      tokens: { input: 0, output: 0, thinking: 0, cached: 0 },
    });
  });
});

describe("estimated cost", () => {
  it("bills thinking as output, cached input at a tenth, and regional endpoints 10% more", () => {
    const t = { input: 1_000_000, cached: 500_000, output: 100_000, thinking: 100_000 };
    // 0.5M × $1.50 + 0.5M × $0.15 + 0.2M × $9 = $2.625 on the global endpoint.
    expect(costMicros("gemini-3.5-flash", "global", t)).toBe(2_625_000);
    expect(costMicros("gemini-3.5-flash", "asia-southeast1", t)).toBe(2_887_500);
    // A model without a rate is priced like the default one, never at zero.
    expect(costMicros("gemini-9-flash", "global", t)).toBeGreaterThan(0);
  });
});
