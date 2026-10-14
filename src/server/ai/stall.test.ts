import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

/** Each test sets how the fake Vertex stream answers: [delay before the part, text of the part]. */
let script: [number, string][] = [];
vi.mock("@google/genai", async (original) => ({
  ...(await original<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = {
      generateContentStream: async ({ config }: { config: { abortSignal: AbortSignal } }) =>
        (async function* () {
          for (const [ms, text] of script) {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, ms);
              config.abortSignal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("This operation was aborted"));
              });
            });
            yield { candidates: [{ content: { parts: [{ text }] } }] };
          }
        })(),
    };
  },
}));

const { generateJson } = await import("./gemini");
const schema = z.object({ n: z.number() });
const input = {
  system: "",
  prompt: "",
  task: "test",
  timeoutMs: 170_000,
  idleMs: 30_000,
  firstPartMs: 60_000,
};

afterEach(() => vi.useRealTimers());

describe("Gemini calls judged by their streaming", () => {
  it("are stopped when the answer goes quiet midway, and can be retried", async () => {
    vi.useFakeTimers();
    script = [
      [5_000, '{"n":'],
      [600_000, "1}"],
    ];
    const result = generateJson(schema, input);
    await vi.advanceTimersByTimeAsync(36_000);
    expect(await result).toEqual({ ok: false, error: "Gemini took too long to answer.", retryable: true });
  });

  it("finish when slow, as long as parts keep coming", async () => {
    vi.useFakeTimers();
    // 45 s of thinking before the first part, then a part every 25 s: 145 s in all, past the old 110 s limit.
    script = [
      [45_000, '{"n":'],
      [25_000, " "],
      [25_000, " "],
      [25_000, "1"],
      [25_000, "}"],
    ];
    const progress = vi.fn();
    const result = generateJson(schema, { ...input, onProgress: progress });
    await vi.advanceTimersByTimeAsync(150_000);
    expect(await result).toMatchObject({ ok: true, data: { n: 1 } });
    expect(progress).toHaveBeenCalledTimes(5);
  });
});
