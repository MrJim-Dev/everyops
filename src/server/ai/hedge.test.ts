import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hedged } from "./gemini";

type R = { ok: true; who: number } | { ok: false; retryable: boolean; who: number };

afterEach(() => vi.useRealTimers());

describe("hedged Gemini calls", () => {
  it("starts a twin when the first call stalls, and the twin's answer wins", async () => {
    vi.useFakeTimers();
    const aborted: number[] = [];
    let n = 0;
    const run = (signal: AbortSignal) => {
      const who = ++n;
      signal.addEventListener("abort", () => aborted.push(who));
      // Call 1 never answers; call 2 answers after 5 s.
      return new Promise<R>((res) =>
        who === 2 ? setTimeout(() => res({ ok: true, who }), 5_000) : undefined,
      );
    };
    const result = hedged(run, { hedgeMs: 20_000 });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toEqual({ ok: true, who: 2 });
    expect(aborted).toContain(1);
    expect(n).toBe(2);
  });

  it("retries at once after a quick failure, and gives up after the last attempt", async () => {
    let n = 0;
    const run = async () => ({ ok: false, retryable: true, who: ++n }) as R;
    expect(await hedged(run, { hedgeMs: 20_000, attempts: 3 })).toEqual({
      ok: false,
      retryable: true,
      who: 3,
    });
  });

  it("doesn't retry a failure that won't change", async () => {
    let n = 0;
    const run = async () => ({ ok: false, retryable: false, who: ++n }) as R;
    expect(await hedged(run, { hedgeMs: 20_000 })).toMatchObject({ who: 1 });
  });
  it("with afterSilence, gives a slow call that keeps streaming no twin", async () => {
    vi.useFakeTimers();
    let n = 0;
    const run = (_signal: AbortSignal, progress: () => void) => {
      const who = ++n;
      // A part every 15 s for 90 s, then the answer.
      const ticks = setInterval(progress, 15_000);
      return new Promise<R>((res) =>
        setTimeout(() => {
          clearInterval(ticks);
          res({ ok: true, who });
        }, 90_000),
      );
    };
    const result = hedged(run, { hedgeMs: 45_000, afterSilence: true });
    await vi.advanceTimersByTimeAsync(95_000);
    expect(await result).toEqual({ ok: true, who: 1 });
    expect(n).toBe(1);
  });

  it("with afterSilence, starts a twin once a call has been quiet for hedgeMs", async () => {
    vi.useFakeTimers();
    let n = 0;
    const started: number[] = [];
    const run = (_signal: AbortSignal, progress: () => void) => {
      const who = ++n;
      started.push(Date.now());
      if (who === 1) {
        // Streams for 30 s, then stalls for good.
        const ticks = setInterval(progress, 10_000);
        setTimeout(() => clearInterval(ticks), 35_000);
        return new Promise<R>(() => {});
      }
      return new Promise<R>((res) => setTimeout(() => res({ ok: true, who }), 10_000));
    };
    const t0 = Date.now();
    const result = hedged(run, { hedgeMs: 45_000, afterSilence: true });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toEqual({ ok: true, who: 2 });
    // The last part came at 30 s, so the twin started at 75 s.
    expect(started.map((t) => t - t0)).toEqual([0, 75_000]);
  });
});
