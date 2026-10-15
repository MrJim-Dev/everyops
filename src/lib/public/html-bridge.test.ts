import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frameDocument } from "./html-page";

function sandbox() {
  vi.useFakeTimers();
  const parent = { postMessage: vi.fn() };
  let message: (event: { source: unknown; data: unknown }) => void = () => {};
  const window = {
    // Only the message listener matters here; the bridge also listens for pointer events (Pick from page).
    addEventListener: (type: string, fn: typeof message) => {
      if (type === "message") message = fn;
    },
  };
  const context = {
    window,
    parent,
    document: { addEventListener: vi.fn() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const script = frameDocument("<p>Test</p>").match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw Error("Missing bridge");
  runInNewContext(script, context);
  const sdk = (
    window as typeof window & {
      EveryOps: {
        data: (id: string) => Promise<unknown>;
        submit: (id: string, values: unknown) => Promise<unknown>;
      };
    }
  ).EveryOps;
  return { parent, sdk, receive: (data: unknown, source: unknown = parent) => message({ data, source }) };
}
afterEach(() => vi.useRealTimers());
describe("HTML bridge startup", () => {
  it("waits for the parent before sending data or writes and never replays a submission", async () => {
    const { parent, sdk, receive } = sandbox();
    const data = sdk.data("catalog");
    const saved = sdk.submit("inquiry", { name: "Test" });
    vi.advanceTimersByTime(500);
    expect(parent.postMessage.mock.calls.every(([m]) => m.everyops === "connect")).toBe(true);
    receive({ everyops: "ready" }, {});
    expect(parent.postMessage.mock.calls.some(([m]) => m.everyops === "submit")).toBe(false);
    receive({ everyops: "ready" });
    receive({ everyops: "ready" });
    vi.advanceTimersByTime(500);
    expect(parent.postMessage.mock.calls.filter(([m]) => m.everyops === "call")).toHaveLength(1);
    expect(parent.postMessage.mock.calls.filter(([m]) => m.everyops === "submit")).toHaveLength(1);
    receive({ everyops: "result", id: 1, result: { ok: true } });
    receive({ everyops: "result", id: 2, result: { ok: true } });
    await expect(data).resolves.toEqual({ ok: true });
    await expect(saved).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out without sending an expired write if the parent arrives late", async () => {
    const { parent, sdk, receive } = sandbox();
    const result = sdk.submit("inquiry", {});
    vi.advanceTimersByTime(30001);
    await expect(result).resolves.toMatchObject({ ok: false });
    receive({ everyops: "ready" });
    expect(parent.postMessage.mock.calls.some(([m]) => m.everyops === "submit")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
