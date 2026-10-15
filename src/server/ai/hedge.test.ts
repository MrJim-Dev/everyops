import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fitToolOutput, hedged, quotaPause } from "./gemini";

type R = { ok: true; who: number } | { ok: false; retryable: boolean; rateLimited?: boolean; who: number };

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

  it("waits before asking again after an out-of-quota answer, and starts no twin meanwhile", async () => {
    vi.useFakeTimers();
    const started: number[] = [];
    let n = 0;
    const run = () => {
      const who = ++n;
      started.push(Date.now());
      return Promise.resolve(
        (who === 1 ? { ok: false, retryable: true, rateLimited: true, who } : { ok: true, who }) as R,
      );
    };
    const t0 = Date.now();
    const result = hedged(run, { hedgeMs: 1_000, attempts: 3 });
    await vi.advanceTimersByTimeAsync(1_000);
    // A plain retryable failure would have been asked again at once; out of quota, nothing yet.
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await result).toEqual({ ok: true, who: 2 });
    expect(started[1] - t0).toBeGreaterThanOrEqual(1_500);
  });

  it("gives up with the quota error once the attempts are used", async () => {
    vi.useFakeTimers();
    let n = 0;
    const run = async () => ({ ok: false, retryable: true, rateLimited: true, who: ++n }) as R;
    const result = hedged(run, { hedgeMs: 1_000, attempts: 2 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ ok: false, rateLimited: true, who: 2 });
  });
});

describe("quotaPause", () => {
  it("doubles from about 2 s and stops growing at about 8 s", () => {
    expect(quotaPause(0, () => 0.5)).toBe(2_000);
    expect(quotaPause(1, () => 0.5)).toBe(4_000);
    expect(quotaPause(5, () => 0.5)).toBe(8_000);
    expect(quotaPause(0, () => 0)).toBe(1_500);
  });
});

describe("fitToolOutput", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: `r${i}`,
    name: `Booking ${i}`,
    note: "x".repeat(80),
  }));
  it("leaves a small result as it is", () => {
    expect(fitToolOutput({ total: 2, records: rows.slice(0, 2) }, 12_000)).toBe(
      JSON.stringify({ total: 2, records: rows.slice(0, 2) }),
    );
  });
  it("drops rows from the longest list so the result stays valid JSON, and says how many fit", () => {
    const text = fitToolOutput({ total: 200, shown: 200, records: rows }, 12_000);
    expect(text.length).toBeLessThanOrEqual(12_000);
    const parsed = JSON.parse(text);
    expect(parsed.result.total).toBe(200);
    expect(parsed.result.records.length).toBeGreaterThan(1);
    expect(parsed.result.records.length).toBeLessThan(200);
    expect(parsed.cut).toContain(`first ${parsed.result.records.length} of 200`);
  });
  it("still returns valid JSON when nothing can be dropped", () => {
    const parsed = JSON.parse(fitToolOutput({ text: "y".repeat(20_000) }, 12_000));
    expect(parsed.cut).toContain("too large");
  });
});
